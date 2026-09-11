import { db } from "./supabase";

/**
 * Image attachments.
 *
 * Files sit in a private Supabase bucket; nothing is readable by guessing a
 * path. The app hands out signed URLs with a long expiry — long enough that
 * a link in an old Cliq message still works, short enough that it isn't
 * permanent public access.
 */

export const BUCKET = "attachments";

export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;          // 10 MB
export const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** A year. Past this, a link in an old message stops rendering. */
const SIGNED_FOR = 60 * 60 * 24 * 365;

export type Owner =
  | { kind: "milestone"; id: string }
  | { kind: "task"; id: string }
  | { kind: "roadblock"; id: string };

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const column = (o: Owner) =>
  o.kind === "milestone" ? "milestone_id"
  : o.kind === "task" ? "task_id"
  : "roadblock_id";

/** Names get cleaned up: the stored path should never depend on user input. */
function safeName(name: string) {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  const stem = name.replace(/\.[^.]*$/, "").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60);
  return `${stem || "image"}${ext}`;
}

export function validate(file: { type: string; size: number; name: string }) {
  if (!ALLOWED.includes(file.type)) {
    return `${file.name} isn't an image we can take — JPG, PNG, GIF or WebP only.`;
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `${file.name} is ${mb} MB. The limit is 10 MB.`;
  }
  return null;
}

export async function countFor(owner: Owner): Promise<number> {
  const { count } = await db
    .from("attachments")
    .select("id", { count: "exact", head: true })
    .eq(column(owner), owner.id);
  return count ?? 0;
}

export async function upload(opts: {
  projectId: string;
  owner: Owner;
  file: File;
  uploadedBy?: string | null;
}): Promise<{ id: string } | { error: string }> {
  const { projectId, owner, file, uploadedBy } = opts;

  const bad = validate(file);
  if (bad) return { error: bad };

  if (await countFor(owner) >= MAX_FILES) {
    return { error: `That already has ${MAX_FILES} images, which is the limit.` };
  }

  // Path carries the project so a bucket listing is navigable, and a random
  // segment so two people uploading "screenshot.png" don't collide.
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${projectId}/${owner.kind}/${owner.id}/${stamp}-${rand}-${safeName(file.name)}`;

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) return { error: `Upload failed: ${upErr.message}` };

  const { data, error } = await db.from("attachments").insert({
    project_id: projectId,
    [column(owner)]: owner.id,
    path,
    filename: file.name.slice(0, 120),
    mime: file.type,
    bytes: file.size,
    uploaded_by: uploadedBy ?? null,
  }).select("id").single();

  if (error) {
    // Don't leave the file orphaned in the bucket if the row failed.
    await db.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }
  return { id: data.id };
}

/** Signed URLs for a set of rows, in one call rather than one each. */
export async function withUrls(rows: any[]): Promise<Attachment[]> {
  if (!rows.length) return [];

  const { data: signed } = await db.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.path), SIGNED_FOR);

  const byPath = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]));

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    bytes: r.bytes,
    url: byPath.get(r.path) ?? null,
    uploaded_by: r.uploaded_by ?? null,
    created_at: r.created_at,
  }));
}

export async function listFor(owner: Owner): Promise<Attachment[]> {
  const { data } = await db
    .from("attachments")
    .select("id, path, filename, mime, bytes, uploaded_by, created_at")
    .eq(column(owner), owner.id)
    .order("created_at");
  return withUrls(data ?? []);
}

/** Everything on a project, grouped by what it hangs off. */
export async function listForProject(projectId: string) {
  const { data } = await db
    .from("attachments")
    .select("id, path, filename, mime, bytes, uploaded_by, created_at, milestone_id, task_id, roadblock_id")
    .eq("project_id", projectId)
    .order("created_at");

  const rows = data ?? [];
  const urls = await withUrls(rows);
  const byId = new Map(urls.map((u) => [u.id, u]));

  const out = {
    milestone: new Map<string, Attachment[]>(),
    task: new Map<string, Attachment[]>(),
    roadblock: new Map<string, Attachment[]>(),
  };

  for (const r of rows) {
    const a = byId.get(r.id);
    if (!a) continue;
    const [bucket, key] =
      r.milestone_id ? [out.milestone, r.milestone_id] as const
      : r.task_id ? [out.task, r.task_id] as const
      : r.roadblock_id ? [out.roadblock, r.roadblock_id] as const
      : [null, null] as const;
    if (!bucket || !key) continue;
    bucket.set(key, [...(bucket.get(key) ?? []), a]);
  }
  return out;
}

export async function remove(id: string): Promise<string | null> {
  const { data } = await db
    .from("attachments").select("path").eq("id", id).single();
  if (!data) return "Not found.";

  await db.storage.from(BUCKET).remove([data.path]);
  const { error } = await db.from("attachments").delete().eq("id", id);
  return error ? error.message : null;
}

/**
 * Images added since the last message, for one item. Marks them announced
 * so tomorrow's reminder doesn't repeat them.
 */
export async function claimUnannounced(owner: Owner): Promise<Attachment[]> {
  const { data } = await db
    .from("attachments")
    .select("id, path, filename, mime, bytes, uploaded_by, created_at")
    .eq(column(owner), owner.id)
    .is("announced_at", null)
    .order("created_at");

  const rows = data ?? [];
  if (!rows.length) return [];

  await db.from("attachments")
    .update({ announced_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  return withUrls(rows);
}

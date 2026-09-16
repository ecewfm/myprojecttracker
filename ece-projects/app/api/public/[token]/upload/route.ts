import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { resolveToken, recordSubmission } from "@/lib/share";
import { upload, type Owner } from "@/lib/attachments";

export const maxDuration = 60;

/**
 * Upload from a share link. Authenticated by the token, and scoped to that
 * token's project — someone can't attach a file to an item on a project
 * their link doesn't cover.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await resolveToken(params.token);
  if (!ctx) return NextResponse.json({ error: "link_inactive" }, { status: 404 });

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");

  if (!["milestone", "task", "roadblock"].includes(kind) || !id) {
    return NextResponse.json({ error: "missing item" }, { status: 400 });
  }

  // Confirm the item really belongs to this token's project.
  const table = kind === "milestone" ? "milestones" : kind === "task" ? "tasks" : "roadblocks";
  const { data: item } = await db
    .from(table)
    .select(kind === "roadblock" ? "id, title, project_id" : "id, name, project_id")
    .eq("id", id).single();

  if (!item || (item as any).project_id !== ctx.projectId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no files" }, { status: 400 });

  const owner = { kind, id } as Owner;
  const added: string[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const res = await upload({
      projectId: ctx.projectId,
      owner,
      file,
      uploadedBy: ctx.member.id,
    });
    if ("error" in res) problems.push(res.error);
    else added.push(res.id);
  }

  if (added.length) {
    const subject = (item as any).name ?? (item as any).title ?? "an item";
    await recordSubmission({
      projectId: ctx.projectId,
      memberId: ctx.member.id,
      memberName: ctx.member.name,
      kind: "note_added",
      subject,
      note: `Attached ${added.length} image${added.length === 1 ? "" : "s"}.`,
    });
  }

  return NextResponse.json({ added: added.length, problems });
}

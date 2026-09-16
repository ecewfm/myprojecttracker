import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/** Unseen submissions — what the badge counts, and what the panel lists. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data } = await db
    .from("submissions")
    .select("id, kind, subject, note, ai_summary, seen, created_at, project_id, team_members ( name ), projects ( title, ref )")
    .order("created_at", { ascending: false })
    .limit(40);

  const rows = (data ?? []).map((s: any) => ({
    id: s.id, kind: s.kind, subject: s.subject, note: s.note,
    ai_summary: s.ai_summary, seen: s.seen, created_at: s.created_at,
    project_id: s.project_id,
    member: s.team_members?.name ?? "Someone",
    project: s.projects?.title ?? "",
  }));

  return NextResponse.json({
    unseen: rows.filter((r) => !r.seen).length,
    items: rows,
  });
}

/** Mark everything (or a set) as seen. */
export async function PATCH(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const q = db.from("submissions").update({ seen: true });
  const { error } = body.ids?.length
    ? await q.in("id", body.ids)
    : await q.eq("seen", false);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

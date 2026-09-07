import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyMilestoneAssignment } from "@/lib/reminders";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  // Remember who it was assigned to, so we only message on a real change.
  const { data: before } = await db
    .from(body.subproject ? "subproject_milestones" : "milestones")
    .select("assignee_id").eq("id", params.id).maybeSingle();

  const patch: Record<string, unknown> = {};
  if ("note" in body) patch.note = body.note;
  if ("name" in body) patch.name = body.name;
  if ("assignee_id" in body) patch.assignee_id = body.assignee_id || null;
  if ("done" in body) {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  const table = body.subproject ? "subproject_milestones" : "milestones";
  const { data, error } = await db
    .from(table).update(patch).eq("id", params.id)
    .select("id, position, name, note, done, assignee:team_members!milestones_assignee_id_fkey(id,name,email,active,job_position,account,site)").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Newly assigned to someone: give them a link and tell them.
  const newAssignee = body.assignee_id;
  if (!body.subproject && newAssignee && newAssignee !== before?.assignee_id) {
    notifyMilestoneAssignment(params.id).catch(() => {});
  }

  return NextResponse.json(data);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const sub = new URL(req.url).searchParams.get("subproject") === "1";
  const table = sub ? "subproject_milestones" : "milestones";
  const { error } = await db.from(table).delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

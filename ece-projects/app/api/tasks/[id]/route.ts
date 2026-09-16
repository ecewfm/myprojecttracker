import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyAssignment } from "@/lib/reminders";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data: existing } = await db
    .from("task_assignees").select("member_id").eq("task_id", params.id);
  const before = new Set((existing ?? []).map((r: any) => r.member_id));

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "due_date", "note"]) if (k in body) patch[k] = body[k];
  if ("done" in body) {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  if (Array.isArray(body.assignee_ids)) {
    const wanted: string[] = body.assignee_ids.filter(Boolean);

    await db.from("task_assignees").delete().eq("task_id", params.id);
    if (wanted.length) {
      await db.from("task_assignees").insert(
        wanted.map((member_id) => ({ task_id: params.id, member_id }))
      );
    }
    for (const id of wanted) {
      if (!before.has(id)) notifyAssignment(params.id, id).catch(() => {});
    }
  }

  // Same as milestones: assignee-only changes touch no columns on the row,
  // and an empty UPDATE returns nothing for .single() to coerce.
  const hasColumnChanges = Object.keys(patch).length > 0;

  const { data, error } = hasColumnChanges
    ? await db.from("tasks").update(patch).eq("id", params.id)
        .select("id, name, done, due_date, note").single()
    : await db.from("tasks").select("id, name, done, due_date, note")
        .eq("id", params.id).single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  await db.from("tasks").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}

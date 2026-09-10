import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyMilestoneAssignment } from "@/lib/reminders";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  // Who was already on it, so only newly added people get messaged.
  const { data: existing } = await db
    .from("milestone_assignees").select("member_id").eq("milestone_id", params.id);
  const before = new Set((existing ?? []).map((r: any) => r.member_id));

  const patch: Record<string, unknown> = {};
  if ("note" in body) patch.note = body.note;
  if ("name" in body) patch.name = body.name;

  if ("due_date" in body) patch.due_date = body.due_date || null;
  if ("done" in body) {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  // Assignees live in their own table now.
  if (Array.isArray(body.assignee_ids)) {
    const wanted: string[] = body.assignee_ids.filter(Boolean);

    await db.from("milestone_assignees").delete().eq("milestone_id", params.id);
    if (wanted.length) {
      await db.from("milestone_assignees").insert(
        wanted.map((member_id) => ({ milestone_id: params.id, member_id }))
      );
    }

    // Tell anyone newly added, once the write has landed.
    for (const id of wanted) {
      if (!before.has(id)) notifyMilestoneAssignment(params.id, id).catch(() => {});
    }
  }

  // Changing only the assignees leaves nothing to update on the row itself.
  // An empty UPDATE returns no rows, which makes .single() throw — so read
  // the row instead of writing it when there are no column changes.
  const hasColumnChanges = Object.keys(patch).length > 0;

  const { data, error } = hasColumnChanges
    ? await db.from("milestones").update(patch).eq("id", params.id)
        .select("id, position, name, note, done, due_date").single()
    : await db.from("milestones").select("id, position, name, note, done, due_date")
        .eq("id", params.id).single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

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

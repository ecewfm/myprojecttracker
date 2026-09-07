import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyAssignment } from "@/lib/reminders";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data: before } = await db
    .from("tasks").select("assignee_id").eq("id", params.id).single();

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "due_date", "assignee_id", "note"]) if (k in body) patch[k] = body[k];
  if ("done" in body) {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  const { data, error } = await db
    .from("tasks").update(patch).eq("id", params.id)
    .select("id, name, done, due_date, note").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const reassigned =
    body.assignee_id && body.assignee_id !== before?.assignee_id && !body.done;
  if (reassigned) notifyAssignment(params.id).catch(() => {});

  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  await db.from("tasks").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}

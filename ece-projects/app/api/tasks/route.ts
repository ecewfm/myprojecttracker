import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyAssignment } from "@/lib/reminders";

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data, error } = await db.from("tasks").insert({
    project_id: body.project_id,
    subproject_id: body.subproject_id ?? null,
    name: body.name,
    due_date: body.due_date ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const ids: string[] = Array.isArray(body.assignee_ids)
    ? body.assignee_ids.filter(Boolean)
    : body.assignee_id ? [body.assignee_id] : [];

  if (ids.length) {
    await db.from("task_assignees").insert(
      ids.map((member_id) => ({ task_id: data.id, member_id }))
    );
    for (const id of ids) notifyAssignment(data.id, id).catch(() => {});
  }

  return NextResponse.json(data, { status: 201 });
}

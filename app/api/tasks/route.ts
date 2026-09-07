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
    assignee_id: body.assignee_id ?? null,
    due_date: body.due_date ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (body.assignee_id) notifyAssignment(data.id).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}

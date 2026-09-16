import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getProject } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const p = await getProject(params.id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const allowed = [
    "title", "status", "phase", "owner_id", "due_date",
    "priority", "shared", "labels", "reminders_on", "archived",
    "cliq_channel",
    "email_enabled", "email_day", "email_hour",
    "email_to", "email_cc", "email_subject",
  ];
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );

  const { error } = await db.from("projects").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(await getProject(params.id));
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  // Truly delete. Cascades remove milestones, subprojects, tasks, and
  // roadblocks via ON DELETE CASCADE on their project_id foreign keys.
  const { error } = await db.from("projects").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}

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
  await db.from("projects").update({ archived: true }).eq("id", params.id);
  return NextResponse.json({ ok: true });
}

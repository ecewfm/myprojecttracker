import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const patch: Record<string, unknown> = {};
  if ("note" in body) patch.note = body.note;
  if ("name" in body) patch.name = body.name;
  if ("done" in body) {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  const table = body.subproject ? "subproject_milestones" : "milestones";
  const { data, error } = await db
    .from(table).update(patch).eq("id", params.id)
    .select("id, position, name, note, done").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

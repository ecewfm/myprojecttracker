import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const table = body.subproject_id ? "subproject_milestones" : "milestones";
  const key   = body.subproject_id ? "subproject_id" : "project_id";
  const id    = body.subproject_id ?? body.project_id;

  const { count } = await db
    .from(table).select("id", { count: "exact", head: true }).eq(key, id);

  const { data, error } = await db.from(table).insert({
    [key]: id,
    position: (count ?? 0) + 1,
    name: body.name,
    note: body.note ?? "",
  }).select("id, position, name, note, done").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  // A parent_id makes this a sub-milestone. Position is scoped to its
  // siblings, so sub-items number 1..n under their own parent.
  const parentId = body.parent_id ?? null;

  const countQuery = db.from("milestones")
    .select("id", { count: "exact", head: true })
    .eq("project_id", body.project_id);

  const { count } = parentId
    ? await countQuery.eq("parent_id", parentId)
    : await countQuery.is("parent_id", null);

  const { data, error } = await db.from("milestones").insert({
    project_id: body.project_id,
    parent_id: parentId,
    position: (count ?? 0) + 1,
    name: body.name,
    note: body.note ?? "",
    due_date: body.due_date ?? null,
  }).select("id, position, name, note, done, parent_id, due_date").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

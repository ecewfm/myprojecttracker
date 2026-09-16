import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/**
 * Reorder action items by dropping one onto another. Tasks have no explicit
 * position column, so order is expressed through created_at — the simplest
 * thing that keeps the list stable without another migration.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, before } = await req.json();

  const [{ data: me }, { data: target }] = await Promise.all([
    db.from("tasks").select("id, project_id, created_at").eq("id", id).single(),
    db.from("tasks").select("id, project_id, created_at").eq("id", before).single(),
  ]);

  if (!me || !target || me.project_id !== target.project_id) {
    return NextResponse.json({ moved: false });
  }

  // Slot it one millisecond ahead of the row it was dropped on.
  const slot = new Date(new Date(target.created_at).getTime() - 1).toISOString();
  const { error } = await db.from("tasks").update({ created_at: slot }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ moved: true });
}

import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/**
 * Move a milestone up or down among its siblings by swapping positions
 * with its neighbour. Sub-milestones reorder within their parent only.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, direction } = await req.json();

  const { data: me } = await db.from("milestones")
    .select("id, position, project_id, parent_id").eq("id", id).single();
  if (!me) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Find the neighbour on the side we're moving toward.
  let q = db.from("milestones")
    .select("id, position")
    .eq("project_id", me.project_id);

  q = me.parent_id ? q.eq("parent_id", me.parent_id) : q.is("parent_id", null);

  const { data: neighbour } = direction === "up"
    ? await q.lt("position", me.position).order("position", { ascending: false }).limit(1).maybeSingle()
    : await q.gt("position", me.position).order("position", { ascending: true }).limit(1).maybeSingle();

  // Already at the end — nothing to do, and not an error.
  if (!neighbour) return NextResponse.json({ moved: false });

  await db.from("milestones").update({ position: neighbour.position }).eq("id", me.id);
  await db.from("milestones").update({ position: me.position }).eq("id", neighbour.id);

  return NextResponse.json({ moved: true });
}

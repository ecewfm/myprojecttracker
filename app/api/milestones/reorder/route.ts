import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/**
 * Move a milestone up or down among its siblings by swapping positions
 * with its neighbour. Sub-milestones reorder within their parent only.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, direction, before } = await req.json();

  const { data: me } = await db.from("milestones")
    .select("id, position, project_id, parent_id").eq("id", id).single();
  if (!me) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Dropped onto another row: take that row's position and shuffle the
  // rest along. Only reorders within the same level, never re-parents.
  if (before) {
    const { data: target } = await db.from("milestones")
      .select("id, position, parent_id, project_id").eq("id", before).single();
    if (!target || target.project_id !== me.project_id) {
      return NextResponse.json({ moved: false });
    }
    if ((target.parent_id ?? null) !== (me.parent_id ?? null)) {
      return NextResponse.json({ moved: false, reason: "different level" });
    }

    let sibs = db.from("milestones").select("id, position")
      .eq("project_id", me.project_id).neq("id", me.id).order("position");
    sibs = me.parent_id ? sibs.eq("parent_id", me.parent_id) : sibs.is("parent_id", null);
    const { data: rest } = await sibs;

    const ordered: string[] = [];
    for (const r of rest ?? []) {
      if (r.id === target.id) ordered.push(me.id);
      ordered.push(r.id);
    }
    if (!ordered.includes(me.id)) ordered.push(me.id);

    for (let i = 0; i < ordered.length; i++) {
      await db.from("milestones").update({ position: i + 1 }).eq("id", ordered[i]);
    }
    return NextResponse.json({ moved: true });
  }

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

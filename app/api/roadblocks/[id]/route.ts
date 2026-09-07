import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyRoadblock } from "@/lib/reminders";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data: current } = await db
    .from("roadblocks").select("status, title, project_id").eq("id", params.id).single();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  for (const k of ["title", "detail", "owner_id", "target_date"]) {
    if (k in body) patch[k] = body[k];
  }

  const changingStatus = body.status && body.status !== current.status;
  if (changingStatus) {
    patch.status = body.status;
    patch.resolved_at = body.status === "resolved" ? new Date().toISOString() : null;
    // A status change restarts the nudge clock rather than firing immediately.
    patch.last_nudge_at = new Date().toISOString();
  }

  const { error } = await db.from("roadblocks").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (changingStatus) {
    await db.from("roadblock_events").insert({
      roadblock_id: params.id,
      from_status: current.status,
      to_status: body.status,
      note: body.note ?? null,
    });

    await log(
      "roadblock",
      `"${current.title}" moved from ${current.status} to ${body.status}`,
      current.project_id
    );

    if (body.status === "escalated") {
      notifyRoadblock(params.id, "escalated").catch(() => {});
    }
  }

  const { data: updated } = await db
    .from("roadblocks")
    .select(`
      id, title, detail, status, raised_at, target_date,
      owner:team_members!roadblocks_owner_id_fkey ( id, name, email )
    `)
    .eq("id", params.id).single();

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  await db.from("roadblocks").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}

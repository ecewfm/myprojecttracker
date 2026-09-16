import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { cliqDM } from "@/lib/zoho";
import { log } from "@/lib/supabase";

/** Add a person to a project's member list. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { member_id } = await req.json();

  const { error } = await db.from("project_members")
    .insert({ project_id: params.id, member_id });
  if (error && !error.message.includes("duplicate")) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Let them know on Cliq.
  const { data } = await db.from("project_members")
    .select("team_members(name,email), projects(title)")
    .eq("project_id", params.id).eq("member_id", member_id).single();
  const row = data as any;
  if (row?.team_members?.email) {
    cliqDM(
      row.team_members.email,
      `You've been added to *${row.projects.title}*. You'll see reminders here for anything assigned to you.`
    ).catch(() => {});
    await log("cliq_dm", `Added ${row.team_members.name} to project`, params.id);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

/** Remove a person from a project's member list. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { member_id } = await req.json();
  const { error } = await db.from("project_members")
    .delete().eq("project_id", params.id).eq("member_id", member_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

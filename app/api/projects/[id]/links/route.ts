import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { makeToken } from "@/lib/share";

/** List the share links for a project, one per person. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data } = await db
    .from("share_links")
    .select("id, token, revoked, last_opened_at, open_count, team_members ( id, name, email )")
    .eq("project_id", params.id);

  return NextResponse.json(
    (data ?? []).map((l: any) => ({
      id: l.id,
      token: l.token,
      revoked: l.revoked,
      last_opened_at: l.last_opened_at,
      open_count: l.open_count,
      member: l.team_members,
    }))
  );
}

/** Create (or re-issue) a link for one person on this project. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { member_id } = await req.json();

  const token = makeToken();

  // One link per person per project — re-issuing replaces the old token,
  // which is also how you revoke-and-reshare in a single step.
  const { data, error } = await db.from("share_links")
    .upsert(
      { project_id: params.id, member_id, token, revoked: false },
      { onConflict: "project_id,member_id" }
    )
    .select("id, token").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/** Revoke a link. The URL stops working immediately. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { member_id } = await req.json();

  const { error } = await db.from("share_links")
    .update({ revoked: true })
    .eq("project_id", params.id).eq("member_id", member_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

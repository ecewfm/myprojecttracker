import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getMembers } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json(await getMembers());
}

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data, error } = await db.from("team_members")
    .insert({
      name: body.name,
      email: body.email.toLowerCase(),
      job_position: body.job_position ?? null,
      account: body.account ?? null,
      site: body.site ?? null,
      zoho_id: body.zoho_id ?? null,
    })
    .select("id, name, email, active, job_position, account, site")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, ...patch } = await req.json();
  const { error } = await db.from("team_members").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * Hard-delete from the app's team list. Accepts one id or an array.
 * This removes the row from Supabase only — Zoho is untouched, and a
 * re-sync brings the person back. Any project that referenced them as
 * owner or assignee falls back to "Unassigned" via the ON DELETE SET NULL
 * foreign keys, so nothing breaks.
 */
export async function DELETE(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { ids } = await req.json();
  const list: string[] = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return NextResponse.json({ error: "no ids given" }, { status: 400 });

  const { error } = await db.from("team_members").delete().in("id", list);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: list.length });
}

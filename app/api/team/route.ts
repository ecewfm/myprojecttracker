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
  const { name, email } = await req.json();

  const { data, error } = await db.from("team_members")
    .insert({ name, email: email.toLowerCase() })
    .select("id, name, email, active").single();

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

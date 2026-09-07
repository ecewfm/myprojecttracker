import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { data } = await db.from("settings").select("*").eq("id", 1).single();
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();
  const { error } = await db.from("settings").update(body).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data } = await db.from("settings").select("*").eq("id", 1).single();
  return NextResponse.json(data);
}

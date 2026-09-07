import { NextResponse } from "next/server";
import { getActivity } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json(await getActivity(15));
}

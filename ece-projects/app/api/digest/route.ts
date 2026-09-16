import { NextResponse } from "next/server";
import { sendDigest } from "@/lib/digest";
import { isSignedIn } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { to } = await req.json().catch(() => ({ to: undefined }));
  try {
    return NextResponse.json(await sendDigest(to));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

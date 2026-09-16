import { NextResponse } from "next/server";
import { sendProjectEmail } from "@/lib/digest";
import { isSignedIn } from "@/lib/auth";

export const maxDuration = 60;

/** Manually send this project's weekly email now. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await sendProjectEmail(params.id, body.to));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

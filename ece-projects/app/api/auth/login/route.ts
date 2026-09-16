import { NextResponse } from "next/server";
import { verifyCredentials, createSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!verifyCredentials(username ?? "", password ?? "")) {
    // Same delay either way so timing doesn't leak which field was wrong.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Those credentials don't match." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(await createSessionCookie());
  return res;
}

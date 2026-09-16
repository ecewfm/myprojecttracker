import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders";

export const maxDuration = 60;

/** Vercel Cron calls this. The secret keeps anyone else from triggering it. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runReminders());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

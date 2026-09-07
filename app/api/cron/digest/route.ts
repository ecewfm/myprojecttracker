import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendDigest } from "@/lib/digest";

export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  // The cron fires on a fixed schedule; this check honours the day you
  // picked in Settings without needing a redeploy to change it.
  const { data: s } = await db.from("settings").select("digest_day").eq("id", 1).single();
  const manilaDay = new Date(Date.now() + 8 * 3600_000).getUTCDay() || 7; // 1=Mon…7=Sun
  if (s && s.digest_day !== manilaDay) {
    return NextResponse.json({ skipped: `configured for day ${s.digest_day}, today is ${manilaDay}` });
  }

  try {
    return NextResponse.json(await sendDigest());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

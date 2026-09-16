import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { runReminders } from "@/lib/reminders";
import { zoneToday } from "@/lib/tz";

export const maxDuration = 60;

/**
 * Run the reminder pass by hand.
 *
 * Useful for two things: proving the pipe works without waiting for the
 * cron, and getting the day's reminders out when the cron has fired at an
 * awkward time. It clears today's claim first so the run isn't refused for
 * having already happened.
 */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  await db.from("settings")
    .update({ last_reminder_run: null, last_second_run: null })
    .eq("id", 1);

  const result = await runReminders();

  return NextResponse.json({
    ...result,
    ranAt: zoneToday(),
  });
}

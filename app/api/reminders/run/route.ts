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

  try {
    // Clearing today's claim is also the first real write, so a missing
    // migration surfaces here with a usable message rather than as a crash
    // somewhere deeper in the run.
    const { error: claimErr } = await db.from("settings")
      .update({ last_reminder_run: null, last_second_run: null })
      .eq("id", 1);

    if (claimErr) {
      return NextResponse.json({
        error:
          `Couldn't reset today's send: ${claimErr.message}. ` +
          `If that mentions a missing column, migration-011.sql hasn't run yet.`,
      }, { status: 400 });
    }

    const result = await runReminders();
    return NextResponse.json({ ...result, ranAt: zoneToday() });

  } catch (e: any) {
    // Without this the route returns an HTML error page, which the button
    // can only report as "failed".
    return NextResponse.json(
      { error: e?.message ?? "The reminder run failed with no message." },
      { status: 500 }
    );
  }
}

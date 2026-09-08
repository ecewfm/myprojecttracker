import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendDigest, sendProjectEmail } from "@/lib/digest";
import { getProjects } from "@/lib/data";
import { zoneWeekday, zoneHour } from "@/lib/tz";

export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { data: s } = await db.from("settings").select("digest_day, digest_hour").eq("id", 1).single();
  const localDay = zoneWeekday(); // 1=Mon … 7=Sun, in the app timezone
  const localHour = zoneHour();

  const results: any = { global: null, projects: [] as any[] };

  // Global portfolio digest (only on its configured day).
  if (!s || (s.digest_day === localDay && (s.digest_hour ?? 9) === localHour)) {
    try { results.global = await sendDigest(); }
    catch (e: any) { results.global = { error: e.message }; }
  } else {
    results.global = {
      skipped: `set for day ${s.digest_day} at ${s.digest_hour}:00; now day ${localDay} hour ${localHour}`,
    };
  }

  // Per-project emails: each fires on its own configured day.
  try {
    const projects = await getProjects();
    for (const p of projects) {
      if (!p.email_enabled) continue;
      if (p.email_day !== localDay) continue;
      if ((p.email_hour ?? 9) !== localHour) continue;
      try {
        const r = await sendProjectEmail(p.id);
        results.projects.push({ project: p.title, ...r });
      } catch (e: any) {
        results.projects.push({ project: p.title, error: e.message });
      }
    }
  } catch (e: any) {
    results.projects.push({ error: e.message });
  }

  return NextResponse.json(results);
}

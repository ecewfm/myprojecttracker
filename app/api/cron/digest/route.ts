import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendDigest, sendProjectEmail } from "@/lib/digest";
import { getProjects } from "@/lib/data";

export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { data: s } = await db.from("settings").select("digest_day").eq("id", 1).single();
  const manilaDay = new Date(Date.now() + 8 * 3600_000).getUTCDay() || 7; // 1=Mon…7=Sun

  const results: any = { global: null, projects: [] as any[] };

  // Global portfolio digest (only on its configured day).
  if (!s || s.digest_day === manilaDay) {
    try { results.global = await sendDigest(); }
    catch (e: any) { results.global = { error: e.message }; }
  } else {
    results.global = { skipped: `configured for day ${s.digest_day}` };
  }

  // Per-project emails: each fires on its own configured day.
  try {
    const projects = await getProjects();
    for (const p of projects) {
      if (!p.email_enabled) continue;
      if (p.email_day !== manilaDay) continue;
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

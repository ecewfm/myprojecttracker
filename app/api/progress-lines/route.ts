import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { writeLine } from "../projects/[id]/progress-line/route";

export const maxDuration = 300;

/**
 * Rewrite the progress line on every project.
 *
 * Lines you've reworded are skipped — the flag exists so an automatic run
 * can't undo your wording. Pass { force: true } to rewrite those too.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  const { data: projects } = await db
    .from("projects")
    .select("id, title, progress_line_mine")
    .eq("archived", false);

  let written = 0, skipped = 0;
  const problems: string[] = [];

  for (const p of projects ?? []) {
    if ((p as any).progress_line_mine && !force) { skipped++; continue; }
    try {
      const line = await writeLine((p as any).id);
      if (line) written++;
      else problems.push(`${(p as any).title}: no line came back`);
    } catch (e: any) {
      problems.push(`${(p as any).title}: ${e.message}`);
    }
  }

  await log("ai", `Progress lines rewritten — ${written} written, ${skipped} left as yours`);
  return NextResponse.json({ written, skipped, problems });
}

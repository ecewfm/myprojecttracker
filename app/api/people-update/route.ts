import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { buildPeopleUpdate, writeImpactLines } from "@/lib/people-update";

export const maxDuration = 300;

/** The weekly update, arranged by person. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    return NextResponse.json(await buildPeopleUpdate());
  } catch (e: any) {
    return NextResponse.json({
      error: /column .* does not exist/i.test(e.message ?? "")
        ? `${e.message} — migration-013.sql hasn't been run yet.`
        : e.message,
    }, { status: 400 });
  }
}

/** Draft the impact lines. Anything you've reworded is left alone. */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await writeImpactLines(body?.force === true));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/** Save your wording for one person's line on one project. */
export async function PATCH(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { memberId, projectId, headline, impact } = await req.json();

  if (!memberId || !projectId) {
    return NextResponse.json({ error: "missing member or project" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { member_id: memberId, project_id: projectId, mine: true };
  if (typeof headline === "string") patch.headline = headline;
  if (typeof impact === "string") patch.impact = impact;

  const { error } = await db.from("impact_lines")
    .upsert(patch, { onConflict: "member_id,project_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

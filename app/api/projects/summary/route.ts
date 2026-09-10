import { NextResponse } from "next/server";
import { getProjectSummaries } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";
import { zoneToday } from "@/lib/tz";

/** What the board and timeline render — a fraction of the full project payload. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json(await getProjectSummaries(zoneToday()));
}

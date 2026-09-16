import { NextResponse } from "next/server";
import { searchRoster } from "@/lib/zoho";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/**
 * Live search against the Zoho roster for the "search and add" box.
 * Marks who is already on the team so the UI can disable those rows.
 * GET /api/team/roster?q=agent
 */
export async function GET(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const [people, existing] = await Promise.all([
      searchRoster(q),
      db.from("team_members").select("email"),
    ]);
    const have = new Set((existing.data ?? []).map((m) => m.email.toLowerCase()));

    return NextResponse.json(
      people.map((p) => ({ ...p, already_added: have.has(p.email.toLowerCase()) }))
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

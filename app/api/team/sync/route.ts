import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { fetchRoster } from "@/lib/zoho";
import { isSignedIn } from "@/lib/auth";

/**
 * Pulls the employee roster from Zoho Creator and upserts it.
 * People are never deleted here — anyone who drops off the roster is
 * marked inactive so historical assignments keep their names.
 */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  try {
    const roster = await fetchRoster();
    if (!roster.length) {
      return NextResponse.json(
        { error: "Zoho returned no rows. Check the report name and field mapping in lib/zoho.ts." },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const { error } = await db.from("team_members").upsert(
      roster.map((r) => ({ ...r, active: true, synced_at: now })),
      { onConflict: "email" }
    );
    if (error) throw error;

    const emails = roster.map((r) => r.email);
    const { data: stale } = await db
      .from("team_members").select("id, email").not("email", "in", `(${emails.map((e) => `"${e}"`).join(",")})`);

    if (stale?.length) {
      await db.from("team_members")
        .update({ active: false })
        .in("id", stale.map((s) => s.id));
    }

    await log("sync", `Roster synced from Zoho — ${roster.length} active, ${stale?.length ?? 0} deactivated`);
    return NextResponse.json({ synced: roster.length, deactivated: stale?.length ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

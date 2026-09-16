import { NextResponse } from "next/server";
import { log } from "@/lib/supabase";
import { createMeeting } from "@/lib/google";
import { getProject } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";
import { cliqDM } from "@/lib/zoho";
import { formatInZone, zoneLabel } from "@/lib/tz";

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { project_id, start, minutes, title, notify } = await req.json();

  const p = await getProject(project_id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const people = [p.owner, ...p.members].filter(Boolean) as { name: string; email: string }[];
  const open = p.roadblocks.filter((r) => r.status !== "resolved");

  try {
    const event = await createMeeting({
      title: title || `${p.title} — sync`,
      description:
        `Progress: ${p.percent}% · ${p.phase ?? ""}\n\n` +
        (open.length
          ? `Open roadblocks:\n${open.map((r) => `• ${r.title}`).join("\n")}`
          : "No open roadblocks."),
      startISO: start,
      minutes: minutes ?? 30,
      attendees: people.map((x) => x.email),
    });

    await log("calendar", `Meeting booked for ${p.title} (${people.length} attendees)`, p.id);

    if (notify !== false) {
      const when = `${formatInZone(start)} ${zoneLabel()}`;
      await Promise.allSettled(
        people.map((x) =>
          cliqDM(x.email, `*${p.title}* — meeting booked for ${when}. Invite is in your calendar.`)
        )
      );
    }

    return NextResponse.json(event);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

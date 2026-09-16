import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { DigestBatch } from "@/lib/digest-batch";
import { zoneToday, daysUntilInZone } from "@/lib/tz";

interface Row {
  key: string;                 // "<kind>:<id>" — stable id for selection
  kind: "milestone" | "task" | "roadblock";
  id: string;
  name: string;
  due_date: string | null;
  days_left: number | null;
  project: { id: string; ref: string; title: string };
  assignees: { id: string; name: string; email: string }[];
  last_nudge_at: string | null;
}

/**
 * Everything approaching or past its due date, across all projects.
 * The window comes from settings (nearing_days, default 5) and can be
 * overridden per request with ?days=N.
 */
export async function GET(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data: settings } = await db
    .from("settings").select("nearing_days").eq("id", 1).single();

  const override = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(override) && override > 0
    ? override
    : settings?.nearing_days ?? 5;

  const today = zoneToday();
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
    .toISOString().slice(0, 10);

  const rows: Row[] = [];

  // ── milestones (including sub-milestones) ──
  const { data: ms } = await db
    .from("milestones")
    .select(`
      id, name, due_date, parent_id,
      projects!inner ( id, ref, title, archived ),
      milestone_assignees ( last_nudge_at, team_members ( id, name, email ) )
    `)
    .eq("done", false)
    .not("due_date", "is", null)
    .lte("due_date", horizon);

  for (const m of (ms ?? []) as any[]) {
    if (m.projects?.archived) continue;
    const people = (m.milestone_assignees ?? []);
    rows.push({
      key: `milestone:${m.id}`,
      kind: "milestone",
      id: m.id,
      name: m.parent_id ? `↳ ${m.name}` : m.name,
      due_date: m.due_date,
      days_left: daysUntilInZone(m.due_date),
      project: { id: m.projects.id, ref: m.projects.ref, title: m.projects.title },
      assignees: people.map((a: any) => a.team_members).filter(Boolean),
      last_nudge_at: people.map((a: any) => a.last_nudge_at).sort().reverse()[0] ?? null,
    });
  }

  // ── action items ──
  const { data: tasks } = await db
    .from("tasks")
    .select(`
      id, name, due_date,
      projects!inner ( id, ref, title, archived ),
      task_assignees ( last_nudge_at, team_members ( id, name, email ) )
    `)
    .eq("done", false)
    .not("due_date", "is", null)
    .lte("due_date", horizon);

  for (const t of (tasks ?? []) as any[]) {
    if (t.projects?.archived) continue;
    const people = (t.task_assignees ?? []);
    rows.push({
      key: `task:${t.id}`,
      kind: "task",
      id: t.id,
      name: t.name,
      due_date: t.due_date,
      days_left: daysUntilInZone(t.due_date),
      project: { id: t.projects.id, ref: t.projects.ref, title: t.projects.title },
      assignees: people.map((a: any) => a.team_members).filter(Boolean),
      last_nudge_at: people.map((a: any) => a.last_nudge_at).sort().reverse()[0] ?? null,
    });
  }

  // ── roadblocks with a target date ──
  const { data: blocks } = await db
    .from("roadblocks")
    .select(`
      id, title, target_date, last_nudge_at, status,
      projects!inner ( id, ref, title, archived ),
      roadblock_owners ( team_members ( id, name, email ) )
    `)
    .neq("status", "resolved")
    .not("target_date", "is", null)
    .lte("target_date", horizon);

  for (const r of (blocks ?? []) as any[]) {
    if (r.projects?.archived) continue;
    rows.push({
      key: `roadblock:${r.id}`,
      kind: "roadblock",
      id: r.id,
      name: r.title,
      due_date: r.target_date,
      days_left: daysUntilInZone(r.target_date),
      project: { id: r.projects.id, ref: r.projects.ref, title: r.projects.title },
      assignees: (r.roadblock_owners ?? []).map((o: any) => o.team_members).filter(Boolean),
      last_nudge_at: r.last_nudge_at,
    });
  }

  // Most overdue first.
  rows.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  return NextResponse.json({ days, today, items: rows });
}

/**
 * Resend DMs for the selected items. This deliberately ignores the normal
 * cadence — it's a manual push, so it fires even if someone was nudged an
 * hour ago. The nudge timestamp is still updated so the automatic loop
 * doesn't immediately message them again.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { keys } = await req.json();
  if (!Array.isArray(keys) || !keys.length) {
    return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  }

  const problems: string[] = [];
  const now = new Date().toISOString();

  // One message per person per project, rather than one per item. Picking
  // eight overdue items used to fire eight separate DMs at whoever owned
  // them, which is the surest way to get the reminders muted.
  const batch = new DigestBatch();

  for (const key of keys as string[]) {
    const [kind, id] = key.split(":");
    try {
      if (kind === "milestone") {
        const { data: m } = await db.from("milestones")
          .select(`
            id, name, due_date,
            projects ( id, title ),
            milestone_assignees ( team_members ( id, name, email ) )
          `)
          .eq("id", id).single();

        const ms = m as any;
        if (!ms) continue;

        for (const a of ms.milestone_assignees ?? []) {
          const who = a.team_members;
          if (!who?.email) continue;
          batch.add(ms.projects.id, who.id, {
            kind: "milestone", name: ms.name, due: ms.due_date,
          });
        }
        await db.from("milestone_assignees")
          .update({ last_nudge_at: now }).eq("milestone_id", id);

      } else if (kind === "task") {
        const { data: t } = await db.from("tasks")
          .select(`
            id, name, due_date,
            projects ( id, title ),
            task_assignees ( team_members ( id, name, email ) )
          `)
          .eq("id", id).single();

        const task = t as any;
        if (!task) continue;

        for (const a of task.task_assignees ?? []) {
          const who = a.team_members;
          if (!who?.email) continue;
          batch.add(task.projects.id, who.id, {
            kind: "task", name: task.name, due: task.due_date,
          });
        }
        await db.from("task_assignees").update({ last_nudge_at: now }).eq("task_id", id);

      } else if (kind === "roadblock") {
        // Owners moved to roadblock_owners; this was still reading the
        // retired single-owner column, so nobody was being messaged.
        const { data: r } = await db.from("roadblocks")
          .select(`
            id, title, target_date,
            projects ( id, title ),
            roadblock_owners ( team_members ( id, name, email ) )
          `)
          .eq("id", id).single();

        const rb = r as any;
        if (!rb) continue;

        for (const o of rb.roadblock_owners ?? []) {
          const who = o.team_members;
          if (!who?.email) continue;
          batch.add(rb.projects.id, who.id, {
            kind: "roadblock", name: rb.title, due: rb.target_date,
          });
        }
        await db.from("roadblock_owners").update({ last_nudge_at: now }).eq("roadblock_id", id);
        await db.from("roadblocks").update({ last_nudge_at: now }).eq("id", id);
      }
    } catch (e: any) {
      problems.push(`${key}: ${e.message}`);
    }
  }

  const people = batch.size;
  const sent = await batch.flush("still open for you");

  if (!sent && !problems.length) {
    problems.push("Nothing was sent — none of the selected items has anyone assigned.");
  }

  await log(
    "cliq_dm",
    `Manual resend — ${sent} message(s) to ${people} person(s) across ${keys.length} item(s)`
  );
  return NextResponse.json({ sent, problems });
}

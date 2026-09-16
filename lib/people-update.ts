import { db } from "./supabase";
import { getProjects } from "./data";
import { generate } from "./gemini";
import { zoneToday } from "./tz";

/**
 * The weekly update, arranged by person.
 *
 * One row per person per project they have open work on. The status and
 * completion come from the data; the impact line is the part the app can't
 * infer, so Gemini drafts it and anything you reword is kept.
 */

export interface PersonRow {
  projectId: string;
  project: string;
  /** The project's own description, shown under its name. */
  description: string;
  headline: string;
  impact: string;
  mine: boolean;
  percent: number | null;
  status: Status;
  /** Sorting only — never shown. */
  weight: number;
}

export interface PersonBlock {
  memberId: string;
  name: string;
  note: string;          // "3 closed last week", "Owns 2 projects"
  rows: PersonRow[];
}

export type Status =
  | "Blocked" | "Behind" | "In progress" | "For testing" | "On track" | "Complete";

/** Worst first, so the top of the table is where the trouble is. */
const WEIGHT: Record<Status, number> = {
  Blocked: 0, Behind: 1, "For testing": 2, "In progress": 3, "On track": 4, Complete: 5,
};

export async function buildPeopleUpdate(): Promise<{
  people: PersonBlock[];
  idle: string[];
  unassigned: number;
}> {
  const today = zoneToday();
  const projects = (await getProjects()).filter((p) => !["done", "scrap"].includes(p.status));

  const { data: team } = await db
    .from("team_members").select("id, name").eq("active", true);

  const { data: stored } = await db
    .from("impact_lines").select("member_id, project_id, headline, impact, mine, status");

  const storedBy = new Map(
    (stored ?? []).map((r: any) => [`${r.member_id}:${r.project_id}`, r])
  );

  // A week back, for "closed last week".
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: recent } = await db
    .from("milestones")
    .select("id, completed_at, milestone_assignees ( member_id )")
    .eq("done", true)
    .gte("completed_at", weekAgo);

  const closedBy = new Map<string, number>();
  for (const m of (recent ?? []) as any[]) {
    for (const a of m.milestone_assignees ?? []) {
      closedBy.set(a.member_id, (closedBy.get(a.member_id) ?? 0) + 1);
    }
  }

  const blocks = new Map<string, PersonBlock>();
  let unassigned = 0;

  for (const p of projects) {
    const flat = p.milestones.flatMap((m) => [m, ...(m.children ?? [])]);
    const openBlocks = p.roadblocks.filter((r) => r.status !== "resolved");

    unassigned +=
      flat.filter((m) => !m.done && !m.assignees.length).length +
      p.tasks.filter((t) => !t.done && !t.assignees.length).length +
      openBlocks.filter((r) => !r.owners.length).length;

    // Who has open work here, and what of.
    const byPerson = new Map<string, { name: string; open: number; late: number; blocked: number }>();

    const touch = (id: string, name: string) =>
      byPerson.get(id) ?? (byPerson.set(id, { name, open: 0, late: 0, blocked: 0 }), byPerson.get(id)!);

    for (const m of flat) {
      if (m.done) continue;
      for (const a of m.assignees) {
        const e = touch(a.id, a.name);
        e.open++;
        if (m.due_date && m.due_date < today) e.late++;
      }
    }
    for (const t of p.tasks) {
      if (t.done) continue;
      for (const a of t.assignees) {
        const e = touch(a.id, a.name);
        e.open++;
        if (t.due_date && t.due_date < today) e.late++;
      }
    }
    for (const r of openBlocks) {
      for (const o of r.owners) {
        const e = touch(o.id, o.name);
        e.blocked++;
      }
    }
    // The owner belongs in the update even with nothing individually assigned.
    if (p.owner && !byPerson.has(p.owner.id)) {
      touch(p.owner.id, p.owner.name);
    }

    for (const [memberId, info] of byPerson) {
      const status: Status =
        info.blocked ? "Blocked"
        : info.late ? "Behind"
        : p.percent >= 100 ? "Complete"
        : p.percent >= 70 ? "For testing"
        : p.percent > 0 ? "In progress"
        : "On track";

      const saved = storedBy.get(`${memberId}:${p.id}`);

      const block = blocks.get(memberId) ?? {
        memberId,
        name: info.name,
        note: "",
        rows: [],
      };

      block.rows.push({
        projectId: p.id,
        project: p.title,
        description: p.description ?? "",
        headline: saved?.headline || p.title,
        impact: saved?.impact ?? "",
        mine: !!saved?.mine,
        percent: p.owner?.id === memberId ? p.percent : null,
        status,
        weight: WEIGHT[status],
      });

      blocks.set(memberId, block);
    }
  }

  // A short note under each name, preferring what they finished.
  for (const b of blocks.values()) {
    const closed = closedBy.get(b.memberId) ?? 0;
    const owns = b.rows.filter((r) => r.percent !== null).length;
    b.note = closed
      ? `${closed} closed last week`
      : owns
        ? `Owns ${owns} project${owns === 1 ? "" : "s"}`
        : `${b.rows.length} workstream${b.rows.length === 1 ? "" : "s"}`;

    b.rows.sort((a, c) => a.weight - c.weight);
  }

  const people = [...blocks.values()].sort((a, c) => {
    const aw = Math.min(...a.rows.map((r) => r.weight));
    const cw = Math.min(...c.rows.map((r) => r.weight));
    return aw - cw || a.name.localeCompare(c.name);
  });

  // Named so their absence is deliberate rather than an oversight.
  const busy = new Set(people.map((p) => p.memberId));
  const idle = (team ?? [])
    .filter((m: any) => !busy.has(m.id))
    .map((m: any) => m.name)
    .sort();

  return { people, idle, unassigned };
}

/**
 * Write the impact lines. Anything you've reworded is skipped unless forced —
 * rewriting a line you'd already fixed would make this worse than useless.
 */
export async function writeImpactLines(force = false) {
  const { people } = await buildPeopleUpdate();
  const projects = await getProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));

  let written = 0, skipped = 0;

  for (const person of people) {
    for (const row of person.rows) {
      if (row.mine && !force) { skipped++; continue; }

      const p = byId.get(row.projectId);
      if (!p) continue;

      const today = zoneToday();
      const flat = p.milestones.flatMap((m) => [m, ...(m.children ?? [])]);
      const theirs = [
        ...flat.filter((m) => !m.done && m.assignees.some((a) => a.name === person.name)),
        ...p.tasks.filter((t) => !t.done && t.assignees.some((a) => a.name === person.name)),
      ];
      const theirBlocks = p.roadblocks.filter(
        (r) => r.status !== "resolved" && r.owners.some((o) => o.name === person.name)
      );

      const facts = [
        `Person: ${person.name}`,
        `Project: ${p.title}`,
        p.description ? `What the project is for: ${p.description}` : null,
        `Project completion: ${p.percent}%`,
        theirs.length
          ? `Their open items: ${theirs.slice(0, 10).map((x: any) =>
              `${x.name}${x.due_date ? ` (due ${x.due_date})` : ""}`).join("; ")}`
          : "No items assigned individually — they own the project.",
        theirs.filter((x: any) => x.due_date && x.due_date < today).length
          ? `Overdue: ${theirs.filter((x: any) => x.due_date && x.due_date < today).length} of those`
          : null,
        theirBlocks.length
          ? `Roadblocks they own: ${theirBlocks.map((r) => `${r.title}${r.detail ? ` — ${r.detail}` : ""}`).join("; ")}`
          : null,
        `Today is ${today}.`,
      ].filter(Boolean).join("\n");

      const prompt =
        `Write one or two sentences for a weekly update, under the heading ` +
        `"how this work is impacting the business".\n\n` +
        `Rules:\n` +
        `- Lead with what the work does for the business, not what state it's in.\n` +
        `- Then, if something is late or blocked, say so plainly and name it.\n` +
        `- Do not start with the person's name or the project name.\n` +
        `- No markdown, no bullets, no preamble. Two sentences at most.\n` +
        `- Do not repeat the completion percentage; it's shown beside this.\n\n` +
        `${facts}`;

      try {
        const text = (await generate(prompt))?.trim();
        if (!text) continue;

        const clean = text.replace(/^[-*#>\s]+/, "").replace(/\*\*/g, "").trim();

        await db.from("impact_lines").upsert({
          member_id: person.memberId,
          project_id: row.projectId,
          headline: row.headline,
          impact: clean,
          status: row.status,
          written_at: new Date().toISOString(),
        }, { onConflict: "member_id,project_id" });

        written++;
      } catch { /* one bad line shouldn't stop the run */ }
    }
  }

  return { written, skipped };
}

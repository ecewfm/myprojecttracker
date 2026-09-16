import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { DigestBatch } from "@/lib/digest-batch";

/**
 * Everyone with something open on this project, and what they'd be sent.
 * Asked for before sending, so a nudge across thirty people isn't a blind
 * click.
 */
async function gather(projectId: string) {
  const [{ data: msRows }, { data: taskRows }, { data: rbRows }] = await Promise.all([
    db.from("milestone_assignees").select(`
      member_id, team_members ( id, name, email ),
      milestones!inner ( id, name, due_date, done, project_id )
    `).eq("milestones.project_id", projectId).eq("milestones.done", false),

    db.from("task_assignees").select(`
      member_id, team_members ( id, name, email ),
      tasks!inner ( id, name, due_date, done, project_id )
    `).eq("tasks.project_id", projectId).eq("tasks.done", false),

    db.from("roadblock_owners").select(`
      member_id, team_members ( id, name, email ),
      roadblocks!inner ( id, title, target_date, status, project_id )
    `).eq("roadblocks.project_id", projectId).neq("roadblocks.status", "resolved"),
  ]);

  const people = new Map<string, {
    id: string; name: string; email: string;
    items: { kind: "milestone" | "task" | "roadblock"; name: string; due: string | null }[];
  }>();

  type Item = { kind: "milestone" | "task" | "roadblock"; name: string; due: string | null };

  const add = (who: any, item: Item) => {
    if (!who?.email) return;
    const entry = people.get(who.id)
      ?? { id: who.id, name: who.name, email: who.email, items: [] as Item[] };
    entry.items.push(item);
    people.set(who.id, entry);
  };

  for (const r of (msRows ?? []) as any[]) {
    add(r.team_members, { kind: "milestone", name: r.milestones.name, due: r.milestones.due_date });
  }
  for (const r of (taskRows ?? []) as any[]) {
    add(r.team_members, { kind: "task", name: r.tasks.name, due: r.tasks.due_date });
  }
  for (const r of (rbRows ?? []) as any[]) {
    add(r.team_members, { kind: "roadblock", name: r.roadblocks.title, due: r.roadblocks.target_date });
  }

  return [...people.values()];
}

/** Preview: who would get a message, and how many items each. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const people = await gather(params.id);
  return NextResponse.json({
    people: people.map((p) => ({ id: p.id, name: p.name, count: p.items.length })),
    total: people.reduce((n, p) => n + p.items.length, 0),
  });
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const people = await gather(params.id);
  if (!people.length) {
    return NextResponse.json({
      error: "Nobody has anything open on this project, so there's nobody to remind.",
    }, { status: 400 });
  }

  const batch = new DigestBatch();
  for (const p of people) {
    for (const item of p.items) batch.add(params.id, p.id, item);
  }

  const sent = await batch.flush("still open for you");

  // Nudging by hand shouldn't cause a second message an hour later.
  const now = new Date().toISOString();
  const ids = people.map((p) => p.id);
  await Promise.all([
    db.from("milestone_assignees").update({ last_nudge_at: now }).in("member_id", ids),
    db.from("task_assignees").update({ last_nudge_at: now }).in("member_id", ids),
  ]);

  await log("cliq_dm", `Project nudge — ${sent} message(s) to ${people.length} person(s)`, params.id, {
    trigger: "Manual — Send reminders from the project panel",
    recipients: people.map((p) => `${p.name} (${p.items.length})`),
    project: params.id,
  });

  return NextResponse.json({ sent, people: people.length });
}

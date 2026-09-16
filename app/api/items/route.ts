import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { zoneToday } from "@/lib/tz";

export const maxDuration = 60;

export interface TableItem {
  id: string;
  projectId: string;
  type: "milestone" | "sub" | "task" | "roadblock";
  name: string;
  parent: string | null;
  assignees: string[];
  due: string | null;
  done: boolean;
  hasNote: boolean;
  hasImages: boolean;
}

export interface TableProject {
  id: string; ref: string; title: string;
  owner: string | null;
  due: string | null;
  percent: number;
  priority: boolean;
  status: string;
}

/**
 * Every item on every project, for the All items table.
 *
 * Four queries regardless of size, rather than one per project — the board
 * carries a few hundred items and a per-project fetch would be slow enough
 * to notice.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const today = zoneToday();

  const [{ data: projects }, { data: milestones }, { data: tasks }, { data: roadblocks }, { data: files }] =
    await Promise.all([
      db.from("projects")
        .select("id, ref, title, status, due_date, priority, owner:team_members!projects_owner_id_fkey ( name )")
        .eq("archived", false)
        .order("created_at"),

      db.from("milestones")
        .select("id, project_id, name, note, done, due_date, parent_id, position, milestone_assignees ( team_members ( name ) )")
        .order("position"),

      db.from("tasks")
        .select("id, project_id, name, note, done, due_date, created_at, task_assignees ( team_members ( name ) )")
        .order("created_at"),

      db.from("roadblocks")
        .select("id, project_id, title, detail, note, status, target_date, roadblock_owners ( team_members ( name ) )")
        .order("raised_at"),

      // Which items carry images, so the table can mark them without
      // fetching signed URLs it won't display.
      db.from("attachments").select("milestone_id, task_id, roadblock_id"),
    ]);

  const withImages = new Set<string>();
  for (const f of files ?? []) {
    const a = f as any;
    if (a.milestone_id) withImages.add(a.milestone_id);
    if (a.task_id) withImages.add(a.task_id);
    if (a.roadblock_id) withImages.add(a.roadblock_id);
  }

  // Parent names, so a sub-milestone can say what it sits under.
  const msById = new Map((milestones ?? []).map((m: any) => [m.id, m]));

  const items: TableItem[] = [];

  for (const m of (milestones ?? []) as any[]) {
    items.push({
      id: m.id,
      projectId: m.project_id,
      type: m.parent_id ? "sub" : "milestone",
      name: m.name,
      parent: m.parent_id ? msById.get(m.parent_id)?.name ?? null : null,
      assignees: (m.milestone_assignees ?? []).map((a: any) => a.team_members?.name).filter(Boolean),
      due: m.due_date,
      done: m.done,
      hasNote: !!m.note,
      hasImages: withImages.has(m.id),
    });
  }

  for (const t of (tasks ?? []) as any[]) {
    items.push({
      id: t.id,
      projectId: t.project_id,
      type: "task",
      name: t.name,
      parent: null,
      assignees: (t.task_assignees ?? []).map((a: any) => a.team_members?.name).filter(Boolean),
      due: t.due_date,
      done: t.done,
      hasNote: !!t.note,
      hasImages: withImages.has(t.id),
    });
  }

  for (const r of (roadblocks ?? []) as any[]) {
    items.push({
      id: r.id,
      projectId: r.project_id,
      type: "roadblock",
      name: r.title,
      parent: null,
      assignees: (r.roadblock_owners ?? []).map((o: any) => o.team_members?.name).filter(Boolean),
      due: r.target_date,
      done: r.status === "resolved",
      hasNote: !!(r.note || r.detail),
      hasImages: withImages.has(r.id),
    });
  }

  // Progress counts top-level milestones, weighted by their children —
  // the same rule the board uses, so the numbers agree.
  const shaped: TableProject[] = (projects ?? []).map((p: any) => {
    const mine = (milestones ?? []).filter((m: any) => m.project_id === p.id);
    const top = mine.filter((m: any) => !m.parent_id);

    const weight = top.reduce((sum: number, m: any) => {
      const kids = mine.filter((c: any) => c.parent_id === m.id);
      if (!kids.length) return sum + (m.done ? 1 : 0);
      return sum + kids.filter((c: any) => c.done).length / kids.length;
    }, 0);

    return {
      id: p.id,
      ref: p.ref,
      title: p.title,
      owner: p.owner?.name ?? null,
      due: p.due_date,
      percent: top.length ? Math.round((weight / top.length) * 100) : 0,
      priority: p.priority,
      status: p.status,
    };
  });

  // Only projects that still exist — items on archived ones are dropped.
  const live = new Set(shaped.map((p) => p.id));

  return NextResponse.json({
    today,
    projects: shaped,
    items: items.filter((i) => live.has(i.projectId)),
  });
}

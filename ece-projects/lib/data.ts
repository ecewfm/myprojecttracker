import { db } from "./supabase";
import type { Project, Member, ProjectStatus } from "./types";

const SELECT = `
  id, ref, title, status, phase, due_date, priority, shared, labels, created_at,
  ai_summary, ai_ran_at, reminders_on,
  cliq_channel, email_enabled, email_day, email_hour, email_to, email_cc, email_subject,
  owner:team_members!projects_owner_id_fkey ( id, name, email, active, job_position, account, site ),
  project_members ( team_members ( id, name, email, active, job_position, account, site ) ),
  milestones (
    id, position, name, note, done, parent_id, due_date,
    milestone_assignees ( team_members ( id, name, email, active, job_position, account, site ) )
  ),
  tasks (
    id, name, done, due_date, note, created_at,
    task_assignees ( team_members ( id, name, email, active, job_position, account, site ) )
  ),
  roadblocks (
    id, title, detail, status, raised_at, target_date, note,
    roadblock_owners ( team_members ( id, name, email, active, job_position, account, site ) )
  )
`;

/**
 * Project completion, weighted by sub-milestones.
 *
 * Each top-level milestone is worth the same share of the project. A
 * milestone with children is worth the fraction of those children that are
 * done, so finishing 20 of 33 accounts moves the number instead of the
 * project sitting still until the parent is ticked. A milestone without
 * children is worth 1 or 0 as before.
 */
export function weightOf(m: { done: boolean; children?: { done: boolean }[] }) {
  const kids = m.children ?? [];
  if (!kids.length) return m.done ? 1 : 0;
  return kids.filter((c) => c.done).length / kids.length;
}

/** A parent with children is complete only when every child is. */
export function isComplete(m: { done: boolean; children?: { done: boolean }[] }) {
  const kids = m.children ?? [];
  return kids.length ? kids.every((c) => c.done) : m.done;
}

function pct(ms: { done: boolean; children?: { done: boolean }[] }[]) {
  if (!ms.length) return 0;
  const total = ms.reduce((sum, m) => sum + weightOf(m), 0);
  return Math.round((total / ms.length) * 100);
}

function shape(row: any): Project {
  // Milestones come back flat; nest sub-milestones under their parent.
  const flat = (row.milestones ?? [])
    .sort((a: any, b: any) => a.position - b.position)
    .map((m: any) => ({
      ...m,
      assignees: (m.milestone_assignees ?? []).map((a: any) => a.team_members).filter(Boolean),
      children: [] as any[],
    }));

  const byId = new Map<string, any>(flat.map((m: any) => [m.id, m]));
  const milestones: any[] = [];
  for (const m of flat) {
    if (m.parent_id && byId.has(m.parent_id)) byId.get(m.parent_id).children.push(m);
    else milestones.push(m);
  }

  // A milestone with children doesn't hold its own completion — it's complete
  // exactly when all its children are. Deriving it here means the panel, the
  // card, the public page and the digest can't disagree about it.
  for (const m of milestones) {
    if (m.children.length) m.done = m.children.every((c: any) => c.done);
  }


  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    status: row.status,
    phase: row.phase,
    due_date: row.due_date,
    priority: row.priority,
    shared: row.shared,
    labels: row.labels ?? [],
    owner: row.owner ?? null,
    members: (row.project_members ?? [])
      .map((pm: any) => pm.team_members)
      .filter(Boolean),
    milestones,
    tasks: (row.tasks ?? [])
      .sort((a: any, b: any) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
      .map((t: any) => ({
      id: t.id,
      name: t.name,
      done: t.done,
      due_date: t.due_date,
      assignees: (t.task_assignees ?? []).map((a: any) => a.team_members).filter(Boolean),
      note: t.note ?? "",
    })),
    roadblocks: (row.roadblocks ?? [])
      .map((r: any) => ({
        ...r,
        owners: (r.roadblock_owners ?? []).map((o: any) => o.team_members).filter(Boolean),
        note: r.note ?? "",
      }))
      .sort((a: any, b: any) => {
        // unresolved first, then newest
        const ar = a.status === "resolved" ? 1 : 0;
        const br = b.status === "resolved" ? 1 : 0;
        if (ar !== br) return ar - br;
        return new Date(b.raised_at).getTime() - new Date(a.raised_at).getTime();
      }),
    created_at: row.created_at,
    percent: pct(milestones),
    ai_summary: row.ai_summary,
    ai_ran_at: row.ai_ran_at,
    reminders_on: row.reminders_on,
    cliq_channel: row.cliq_channel ?? null,
    email_enabled: row.email_enabled ?? false,
    email_day: row.email_day ?? 5,
    email_hour: row.email_hour ?? 9,
    email_to: row.email_to ?? [],
    email_cc: row.email_cc ?? [],
    email_subject: row.email_subject ?? null,
  };
}

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await db
    .from("projects")
    .select(SELECT)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(shape);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await db.from("projects").select(SELECT).eq("id", id).single();
  if (error) return null;
  return shape(data);
}

export async function getMembers(): Promise<Member[]> {
  const { data } = await db
    .from("team_members")
    .select("id, name, email, active, job_position, account, site")
    .eq("active", true)
    .order("name");
  return data ?? [];
}

export async function getSettings() {
  const { data } = await db.from("settings").select("*").eq("id", 1).single();
  return data;
}

export async function getActivity(limit = 12) {
  const { data } = await db
    .from("activity_log")
    .select("id, kind, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** A short unique code for the card, e.g. "HD8F". */
export async function nextRef(): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 12; attempt++) {
    const ref = Array.from(
      { length: 4 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
    const { count } = await db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("ref", ref);
    if (!count) return ref;
  }
  return Date.now().toString(36).slice(-4).toUpperCase();
}

export const COLUMN_KEYS: ProjectStatus[] = [
  "todo", "pending", "dev", "testing", "done", "impl", "scrap",
];

/* ══════════════════════════════════════════════════════════
   Board and timeline summaries.

   The full SELECT above pulls every note, roadblock detail and
   employee record for every project — far more than a card needs,
   and the reason the board felt slow. These queries fetch only
   what's rendered, and the panel loads the full project on open.
   ══════════════════════════════════════════════════════════ */

const SUMMARY_SELECT = `
  id, ref, title, status, due_date, priority, shared, labels, created_at,
  owner:team_members!projects_owner_id_fkey ( id, name ),
  project_members ( team_members ( id, name ) ),
  milestones ( id, position, done, parent_id, due_date, note ),
  tasks ( id, done, due_date ),
  roadblocks ( id, status )
`;

export interface ProjectSummary {
  id: string; ref: string; title: string; status: ProjectStatus;
  due_date: string | null; created_at: string;
  priority: boolean; shared: boolean;
  labels: { name: string; color: string }[];
  owner: { id: string; name: string } | null;
  members: { id: string; name: string }[];
  /** Top-level only, in order — what the card's tick row draws. */
  milestones: {
    id: string; done: boolean; hasNote: boolean;
    due_date: string | null; sub: boolean;
  }[];
  percent: number;
  openRoadblocks: number;
  overdueTasks: number;
  overdueMilestones: number;
}

export async function getProjectSummaries(today: string): Promise<ProjectSummary[]> {
  const { data, error } = await db
    .from("projects")
    .select(SUMMARY_SELECT)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const all = (row.milestones ?? []).sort((a: any, b: any) => a.position - b.position);
    const top = all.filter((m: any) => !m.parent_id);

    // Attach children so the weighting and the derived completion match
    // what the full project query produces.
    const kidsOf = new Map<string, any[]>();
    for (const m of all) {
      if (!m.parent_id) continue;
      kidsOf.set(m.parent_id, [...(kidsOf.get(m.parent_id) ?? []), m]);
    }
    for (const m of top) {
      m.children = kidsOf.get(m.id) ?? [];
      if (m.children.length) m.done = m.children.every((c: any) => c.done);
    }

    return {
      id: row.id,
      ref: row.ref,
      title: row.title,
      status: row.status,
      due_date: row.due_date,
      created_at: row.created_at,
      priority: row.priority,
      shared: row.shared,
      labels: row.labels ?? [],
      owner: row.owner ?? null,
      members: (row.project_members ?? []).map((pm: any) => pm.team_members).filter(Boolean),
      milestones: all.map((m: any) => ({
        id: m.id,
        done: m.done,
        hasNote: !!(m.note && m.note.length),
        due_date: m.due_date,
        sub: !!m.parent_id,
      })),
      percent: pct(top),
      openRoadblocks: (row.roadblocks ?? []).filter((r: any) => r.status !== "resolved").length,
      overdueTasks: (row.tasks ?? []).filter(
        (t: any) => !t.done && t.due_date && t.due_date < today
      ).length,
      overdueMilestones: all.filter(
        (m: any) => !m.done && m.due_date && m.due_date < today
      ).length,
    };
  });
}

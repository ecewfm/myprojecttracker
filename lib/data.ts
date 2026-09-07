import { db } from "./supabase";
import type { Project, Member, ProjectStatus } from "./types";

const SELECT = `
  id, ref, title, status, phase, due_date, priority, shared, labels,
  ai_summary, ai_ran_at, reminders_on,
  cliq_channel, email_enabled, email_day, email_hour, email_to, email_cc, email_subject,
  owner:team_members!projects_owner_id_fkey ( id, name, email, active, job_position, account, site ),
  project_members ( team_members ( id, name, email, active, job_position, account, site ) ),
  milestones (
    id, position, name, note, done, parent_id,
    assignee:team_members!milestones_assignee_id_fkey ( id, name, email, active, job_position, account, site )
  ),
  tasks (
    id, name, done, due_date, note,
    assignee:team_members!tasks_assignee_id_fkey ( id, name, email, active, job_position, account, site )
  ),
  roadblocks (
    id, title, detail, status, raised_at, target_date,
    owner:team_members!roadblocks_owner_id_fkey ( id, name, email, active, job_position, account, site )
  )
`;

function pct(ms: { done: boolean }[]) {
  if (!ms.length) return 0;
  return Math.round((ms.filter((m) => m.done).length / ms.length) * 100);
}

function shape(row: any): Project {
  // Milestones come back flat; nest sub-milestones under their parent.
  const flat = (row.milestones ?? [])
    .sort((a: any, b: any) => a.position - b.position)
    .map((m: any) => ({ ...m, assignee: m.assignee ?? null, children: [] as any[] }));

  const byId = new Map<string, any>(flat.map((m: any) => [m.id, m]));
  const milestones: any[] = [];
  for (const m of flat) {
    if (m.parent_id && byId.has(m.parent_id)) byId.get(m.parent_id).children.push(m);
    else milestones.push(m);
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
    tasks: (row.tasks ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      done: t.done,
      due_date: t.due_date,
      assignee: t.assignee ?? null,
      note: t.note ?? "",
    })),
    roadblocks: (row.roadblocks ?? [])
      .map((r: any) => ({ ...r, owner: r.owner ?? null }))
      .sort((a: any, b: any) => {
        // unresolved first, then newest
        const ar = a.status === "resolved" ? 1 : 0;
        const br = b.status === "resolved" ? 1 : 0;
        if (ar !== br) return ar - br;
        return new Date(b.raised_at).getTime() - new Date(a.raised_at).getTime();
      }),
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

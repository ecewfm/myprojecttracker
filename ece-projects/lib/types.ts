export type ProjectStatus =
  | "todo" | "pending" | "dev" | "testing" | "done" | "impl" | "scrap";

export type RoadblockStatus = "open" | "progress" | "escalated" | "resolved";

export const STATUS_COLUMNS: { key: ProjectStatus; label: string; dim?: boolean }[] = [
  { key: "todo",    label: "To do" },
  { key: "pending", label: "Pending" },
  { key: "dev",     label: "In development" },
  { key: "testing", label: "In testing" },
  { key: "done",    label: "Done" },
  { key: "impl",    label: "Implemented" },
  { key: "scrap",   label: "Scrapped", dim: true },
];

export const ROADBLOCK_STATUS: Record<RoadblockStatus, { label: string; color: string }> = {
  open:      { label: "Open",        color: "#b8453a" },
  progress:  { label: "In progress", color: "#d97b1f" },
  escalated: { label: "Escalated",   color: "#5f4f87" },
  resolved:  { label: "Resolved",    color: "#3f7a5c" },
};

export interface Member {
  id: string; name: string; email: string; active: boolean;
  job_position: string | null; account: string | null; site: string | null;
}
export interface Milestone {
  id: string; position: number; name: string; note: string; done: boolean;
  assignees: Member[];
  parent_id: string | null;
  due_date: string | null;
  children: Milestone[];
}
export interface Roadblock {
  id: string; title: string; detail: string; status: RoadblockStatus;
  owners: Member[]; note: string;
  raised_at: string; target_date: string | null;
}
export interface Task {
  id: string; name: string; done: boolean; due_date: string | null;
  assignees: Member[]; note: string;
}
export interface Project {
  id: string; ref: string; title: string; status: ProjectStatus;
  phase: string | null; due_date: string | null;
  priority: boolean; shared: boolean;
  labels: { name: string; color: string }[];
  owner: Member | null; members: Member[];
  milestones: Milestone[];
  tasks: Task[]; roadblocks: Roadblock[];
  created_at: string;
  percent: number; ai_summary: string | null; ai_ran_at: string | null;
  reminders_on: boolean;
  cliq_channel: string | null;
  email_enabled: boolean; email_day: number; email_hour: number;
  email_to: string[]; email_cc: string[]; email_subject: string | null;
}

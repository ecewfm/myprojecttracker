import * as XLSX from "xlsx";
import type { Project } from "./types";

/**
 * The workbook format used for export, the blank template, and import.
 *
 * One sheet per type. Every row carries an ID: keep it and the row is
 * updated, clear it (or add a new line) and the row is created. Put DELETE
 * in the Action column to remove it. People are matched by email.
 */

export const SHEETS = {
  project: "Project",
  milestones: "Milestones",
  tasks: "Action items",
  roadblocks: "Roadblocks",
  guide: "How to use",
} as const;

/* ── column headers, in order ───────────────────────────── */
const MILESTONE_COLS = [
  "ID", "Action", "Milestone", "Parent ID", "Done", "Due date",
  "Assigned emails", "Notes",
];
const TASK_COLS = [
  "ID", "Action", "Action item", "Done", "Due date", "Assigned emails", "Notes",
];
const ROADBLOCK_COLS = [
  "ID", "Action", "Roadblock", "Detail", "Status", "Owner email", "Target date",
];
const PROJECT_COLS = ["Field", "Value"];

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const emails = (people: { email: string }[]) =>
  people.map((p) => p.email).join(", ");

/** Widths that make the file readable without fiddling. */
function widths(cols: string[], wide: string[] = []) {
  return cols.map((c) => ({ wch: wide.includes(c) ? 42 : c === "ID" ? 38 : 18 }));
}

function guideSheet() {
  const rows = [
    ["How this file works"],
    [],
    ["Editing an existing project"],
    ["Keep the ID column exactly as it is. That's how rows are matched."],
    ["Change any other cell and it updates on import."],
    ["Add a row and leave ID blank to create something new."],
    ["Type DELETE in the Action column to remove that row."],
    ["Leave the Action column blank for a normal update."],
    [],
    ["Creating a new project"],
    ["Leave the Project ID blank on the Project sheet and set a Title."],
    ["Every row will be created fresh."],
    [],
    ["People"],
    ["Assigned emails takes several addresses separated by commas."],
    ["An email that isn't on your team yet is added automatically."],
    ["Check spelling — a typo creates a new person who won't receive messages."],
    [],
    ["Sub-milestones"],
    ["Put the parent milestone's ID in the Parent ID column."],
    ["Leave it blank for a top-level milestone."],
    [],
    ["Dates"],
    ["Use YYYY-MM-DD, for example 2026-09-30. Leave blank for none."],
    [],
    ["Done"],
    ["Yes or No."],
  ].map((r) => r);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 78 }];
  return ws;
}

/** Build the workbook for one project, or a blank template. */
export function buildWorkbook(p: Project | null): Buffer {
  const wb = XLSX.utils.book_new();

  // ── Project ──
  const projectRows = [
    PROJECT_COLS,
    ["Project ID", p?.id ?? ""],
    ["Title", p?.title ?? ""],
    ["Reference", p?.ref ?? ""],
    ["Status", p?.status ?? "todo"],
    ["Target date", p?.due_date ?? ""],
    ["Owner email", p?.owner?.email ?? ""],
    ["Priority", p ? yesNo(p.priority) : "No"],
    ["Team emails", p ? emails(p.members) : ""],
  ];
  const wsP = XLSX.utils.aoa_to_sheet(projectRows);
  wsP["!cols"] = [{ wch: 20 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, wsP, SHEETS.project);

  // ── Milestones (parents then their children) ──
  const msRows: any[][] = [MILESTONE_COLS];
  for (const m of p?.milestones ?? []) {
    msRows.push([
      m.id, "", m.name, "", yesNo(m.done), m.due_date ?? "",
      emails(m.assignees ?? []), m.note ?? "",
    ]);
    for (const c of m.children ?? []) {
      msRows.push([
        c.id, "", c.name, m.id, yesNo(c.done), c.due_date ?? "",
        emails(c.assignees ?? []), c.note ?? "",
      ]);
    }
  }
  const wsM = XLSX.utils.aoa_to_sheet(msRows);
  wsM["!cols"] = widths(MILESTONE_COLS, ["Milestone", "Assigned emails", "Notes"]);
  XLSX.utils.book_append_sheet(wb, wsM, SHEETS.milestones);

  // ── Action items ──
  const tRows: any[][] = [TASK_COLS];
  for (const t of p?.tasks ?? []) {
    tRows.push([
      t.id, "", t.name, yesNo(t.done), t.due_date ?? "",
      emails(t.assignees ?? []), t.note ?? "",
    ]);
  }
  const wsT = XLSX.utils.aoa_to_sheet(tRows);
  wsT["!cols"] = widths(TASK_COLS, ["Action item", "Assigned emails", "Notes"]);
  XLSX.utils.book_append_sheet(wb, wsT, SHEETS.tasks);

  // ── Roadblocks ──
  const rRows: any[][] = [ROADBLOCK_COLS];
  for (const r of p?.roadblocks ?? []) {
    rRows.push([
      r.id, "", r.title, r.detail ?? "", r.status,
      r.owner?.email ?? "", r.target_date ?? "",
    ]);
  }
  const wsR = XLSX.utils.aoa_to_sheet(rRows);
  wsR["!cols"] = widths(ROADBLOCK_COLS, ["Roadblock", "Detail"]);
  XLSX.utils.book_append_sheet(wb, wsR, SHEETS.roadblocks);

  XLSX.utils.book_append_sheet(wb, guideSheet(), SHEETS.guide);

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/* ══════════ parsing ══════════ */

export interface ParsedRow { [key: string]: string }
export interface Parsed {
  project: Record<string, string>;
  milestones: ParsedRow[];
  tasks: ParsedRow[];
  roadblocks: ParsedRow[];
}

const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).trim();

/** Excel dates arrive as numbers; normalise everything to YYYY-MM-DD. */
export function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Serial date from Excel
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = XLSX.SSF.parse_date_code(n);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export const toBool = (v: unknown) => /^(yes|y|true|1|done)$/i.test(str(v));

export function splitEmails(v: unknown): string[] {
  return str(v)
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

function sheetRows(wb: XLSX.WorkBook, name: string): ParsedRow[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return raw.map((r) => {
    const out: ParsedRow = {};
    for (const [k, v] of Object.entries(r)) out[str(k)] = str(v);
    return out;
  });
}

export function parseWorkbook(buf: ArrayBuffer): Parsed {
  const wb = XLSX.read(buf, { type: "array" });

  // Project sheet is Field/Value pairs rather than a table.
  const project: Record<string, string> = {};
  const ws = wb.Sheets[SHEETS.project];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    for (const r of rows) {
      const field = str((r as any)["Field"]);
      if (field) project[field] = str((r as any)["Value"]);
    }
  }

  return {
    project,
    milestones: sheetRows(wb, SHEETS.milestones),
    tasks: sheetRows(wb, SHEETS.tasks),
    roadblocks: sheetRows(wb, SHEETS.roadblocks),
  };
}

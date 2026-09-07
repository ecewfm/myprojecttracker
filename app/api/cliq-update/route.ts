import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { getProject } from "@/lib/data";
import { cliqChannel } from "@/lib/zoho";
import { analyseProject } from "@/lib/gemini";
import { isSignedIn } from "@/lib/auth";
import { STATUS_COLUMNS } from "@/lib/types";

/** Post a project update to its Cliq channel: terse status + Gemini summary. */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { project_id } = await req.json();

  const p = await getProject(project_id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!p.cliq_channel) {
    return NextResponse.json({ error: "No Cliq channel set for this project." }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const open = p.roadblocks.filter((r) => r.status !== "resolved");
  const overdue = p.tasks.filter((t) => !t.done && t.due_date && t.due_date < today);
  const col = STATUS_COLUMNS.find((c) => c.key === p.status)?.label ?? p.status;

  // Gemini summary (uses the saved custom prompt if any).
  let summary = "";
  try {
    const { data: settings } = await db.from("settings").select("analysis_prompt").eq("id", 1).single();
    summary = await analyseProject({
      title: p.title, status: p.status, phase: p.phase, percent: p.percent, due_date: p.due_date,
      milestones: p.milestones.map((m) => ({ name: m.name, done: m.done, note: m.note })),
      roadblocks: p.roadblocks.map((r) => ({
        title: r.title, detail: r.detail, status: r.status,
        raised_at: r.raised_at, owner: r.owner?.name ?? "unassigned",
      })),
      tasks: p.tasks.map((t) => ({
        name: t.name, done: t.done, due_date: t.due_date, assignee: t.assignee?.name ?? "unassigned",
      })),
    }, settings?.analysis_prompt);
  } catch { /* post the status even if the AI part fails */ }

  const msg =
    `*${p.title}* — ${p.percent}% · ${col}\n` +
    `Phase: ${p.phase ?? "not set"}\n` +
    `Open roadblocks: ${open.length}${open.length ? " (" + open.map((r) => r.title).join("; ") + ")" : ""}\n` +
    `Overdue items: ${overdue.length}` +
    (summary ? `\n\n${summary}` : "");

  try {
    await cliqChannel(p.cliq_channel, msg);
    await log("cliq_update", `Posted update to #${p.cliq_channel} for ${p.title}`, p.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

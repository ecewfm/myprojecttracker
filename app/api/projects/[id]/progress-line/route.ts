import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { getProject } from "@/lib/data";
import { generate } from "@/lib/gemini";
import { zoneToday } from "@/lib/tz";

export const maxDuration = 60;

/**
 * The one-line read on a project, shown in the table and the weekly email.
 *
 * PATCH saves your wording and marks the line as yours, so a later refresh
 * leaves it alone — rewriting a line you'd already fixed would make the
 * feature worse than useless.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const patch: Record<string, unknown> = {};

  if (typeof body.description === "string") {
    patch.description = body.description;
  }
  if (typeof body.progressLine === "string") {
    patch.progress_line = body.progressLine;
    patch.progress_line_at = new Date().toISOString();
    patch.progress_line_mine = true;
  }
  if (body.releaseToAI === true) {
    // "Let the AI have this one back" — undoes the mine flag.
    patch.progress_line_mine = false;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const { error } = await db.from("projects").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/** Write the line from what's actually on the project right now. */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const line = await writeLine(params.id);
  if (!line) return NextResponse.json({ error: "Couldn't write a line for that project." }, { status: 400 });

  return NextResponse.json({ progressLine: line });
}

/**
 * Shared with the bulk refresh. Returns the line, or null if the project
 * couldn't be read.
 */
export async function writeLine(projectId: string): Promise<string | null> {
  const p = await getProject(projectId);
  if (!p) return null;

  const today = zoneToday();
  const flat = p.milestones.flatMap((m) => [m, ...(m.children ?? [])]);

  const overdue = [
    ...flat.filter((m) => !m.done && m.due_date && m.due_date < today),
    ...p.tasks.filter((t) => !t.done && t.due_date && t.due_date < today),
  ];
  const openBlocks = p.roadblocks.filter((r) => r.status !== "resolved");

  const facts = [
    `Project: ${p.title}`,
    p.description ? `What it is: ${p.description}` : null,
    `Completion: ${p.percent}%`,
    p.due_date ? `Target date: ${p.due_date} (today is ${today})` : "No target date set.",
    `Milestones: ${flat.filter((m) => m.done).length} done of ${flat.length}`,
    `Open action items: ${p.tasks.filter((t) => !t.done).length}`,
    overdue.length
      ? `Overdue (${overdue.length}): ${overdue.slice(0, 6).map((x: any) => `${x.name} (due ${x.due_date})`).join("; ")}`
      : "Nothing overdue.",
    openBlocks.length
      ? `Roadblocks: ${openBlocks.map((r) => `${r.title}${r.detail ? ` — ${r.detail}` : ""}`).join("; ")}`
      : "No open roadblocks.",
    // Notes are where the real context lives, so they're worth the tokens.
    flat.filter((m) => m.note).slice(0, 8).map((m) => `Note on ${m.name}: ${m.note}`).join("\n"),
  ].filter(Boolean).join("\n");

  const prompt =
    `You are writing one sentence about a project for a weekly update read by ` +
    `an operations manager.\n\n` +
    `Rules:\n` +
    `- One or two sentences. No more.\n` +
    `- Say what the state actually is, including bad news. Do not be diplomatic.\n` +
    `- Name the specific thing holding it up, if something is.\n` +
    `- No preamble, no "This project...", no bullet points, no markdown.\n` +
    `- Do not repeat the completion percentage; the reader can see it.\n\n` +
    `${facts}`;

  const line = (await generate(prompt))?.trim();
  if (!line) return null;

  // Strip anything markdown-ish the model adds despite being told not to.
  const clean = line.replace(/^[-*#>\s]+/, "").replace(/\*\*/g, "").trim();

  await db.from("projects").update({
    progress_line: clean,
    progress_line_at: new Date().toISOString(),
  }).eq("id", projectId);

  return clean;
}

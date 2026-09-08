import { zoneToday, TZ } from "./tz";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

async function generate(prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini failed (${res.status}): ${await res.text()}`);
  const json = await res.json();

  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim() ?? "";

  // MAX_TOKENS means the model was cut off mid-thought. Better to end on a
  // clean sentence than to show a fragment that stops mid-word.
  if (candidate?.finishReason === "MAX_TOKENS" && text) {
    const lastStop = Math.max(
      text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?")
    );
    if (lastStop > 40) return text.slice(0, lastStop + 1);
  }

  return text;
}

const VOICE = `You are analysing a workforce-management project for the RTA manager
who owns it. Write 2-3 short paragraphs of plain prose. No headings, no bullets,
no preamble. Be specific about what is actually holding the project up and what
should happen next. If nothing is blocked, say so and move on rather than
inventing concern. Do not restate the numbers back at the reader.`;

export async function analyseProject(
  p: {
    title: string; status: string; phase: string | null; percent: number;
    due_date: string | null;
    milestones: { name: string; done: boolean; note: string }[];
    roadblocks: { title: string; detail: string; status: string; raised_at: string; owner: string }[];
    tasks: { name: string; done: boolean; due_date: string | null; assignee: string }[];
  },
  userPrompt?: string
) {
  const open = p.roadblocks.filter((r) => r.status !== "resolved");
  const notes = p.milestones.filter((m) => m.note).map((m) => `- ${m.name}: ${m.note}`);
  const overdue = p.tasks.filter(
    (t) => !t.done && t.due_date && new Date(t.due_date) < new Date()
  );

  const extra = (userPrompt ?? "").trim();
  const voice = extra
    ? `${VOICE}\n\nThe person has also asked you to keep this in mind:\n${extra}`
    : VOICE;

  const prompt = `${voice}

Project: ${p.title}
Board column: ${p.status}
Current phase: ${p.phase ?? "not set"}
Progress: ${p.percent}% (${p.milestones.filter((m) => m.done).length}/${p.milestones.length} milestones)
Target date: ${p.due_date ?? "none set"}
Today: ${zoneToday()} (${TZ})

Open roadblocks (${open.length}):
${open.length ? open.map((r) =>
  `- [${r.status}] ${r.title} — ${r.detail} (owner ${r.owner}, raised ${r.raised_at.slice(0, 10)})`
).join("\n") : "none"}

Overdue action items (${overdue.length}):
${overdue.length ? overdue.map((t) => `- ${t.name} (${t.assignee}, due ${t.due_date})`).join("\n") : "none"}

Notes the team left on milestones:
${notes.length ? notes.join("\n") : "none"}`;

  return generate(prompt);
}

export async function analysePortfolio(
  rows: {
    title: string; percent: number; status: string;
    openRoadblocks: number; escalated: number; overdueTasks: number;
    due_date: string | null;
  }[],
  userPrompt?: string
) {
  const extra = (userPrompt ?? "").trim();
  const voice = extra
    ? `${VOICE}\n\nThe person has also asked you to keep this in mind:\n${extra}`
    : VOICE;

  const prompt = `${voice}

Write one short paragraph for a weekly email summarising the whole portfolio.
Lead with whatever most needs the reader's attention this week.

${rows.map((r) =>
  `- ${r.title}: ${r.percent}%, ${r.status}, ${r.openRoadblocks} open roadblock(s)` +
  `${r.escalated ? ` (${r.escalated} escalated)` : ""}` +
  `${r.overdueTasks ? `, ${r.overdueTasks} overdue item(s)` : ""}` +
  `${r.due_date ? `, due ${r.due_date}` : ""}`
).join("\n")}`;

  return generate(prompt);
}

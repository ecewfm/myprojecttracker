import { db, log } from "./supabase";
import { cliqDM } from "./zoho";
import { getProject } from "./data";

/** URL-safe random token. 32 bytes is well past guessable. */
export function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface LinkContext {
  link: { id: string; project_id: string; member_id: string };
  member: { id: string; name: string; email: string };
  projectId: string;
}

/**
 * Resolve a share token to its person and project.
 * Returns null for unknown or revoked tokens — the page shows a plain
 * "this link is no longer active" rather than leaking whether it existed.
 */
export async function resolveToken(token: string): Promise<LinkContext | null> {
  if (!token || token.length < 20) return null;

  const { data } = await db
    .from("share_links")
    .select(`
      id, project_id, member_id, revoked,
      team_members ( id, name, email )
    `)
    .eq("token", token)
    .maybeSingle();

  const row = data as any;
  if (!row || row.revoked || !row.team_members) return null;

  // Record the visit, but don't let a failure here block the page.
  db.from("share_links")
    .update({ last_opened_at: new Date().toISOString(), open_count: (row.open_count ?? 0) + 1 })
    .eq("id", row.id)
    .then(() => {}, () => {});

  return {
    link: { id: row.id, project_id: row.project_id, member_id: row.member_id },
    member: row.team_members,
    projectId: row.project_id,
  };
}

/**
 * Record what someone submitted, have Gemini read it, then notify the owner
 * on Cliq. The submission row also drives the unseen badge in the board.
 */
export async function recordSubmission(opts: {
  projectId: string;
  memberId: string;
  memberName: string;
  kind: "task_closed" | "milestone_closed" | "roadblock_added" | "note_added";
  subject: string;
  note?: string;
}) {
  const { data: row } = await db.from("submissions").insert({
    project_id: opts.projectId,
    member_id: opts.memberId,
    kind: opts.kind,
    subject: opts.subject,
    note: opts.note ?? "",
  }).select("id").single();

  // AI reading + owner notification run in the background — the person
  // submitting shouldn't wait on either.
  reviewAndNotify(row?.id, opts).catch(() => {});

  return row?.id;
}

const KIND_LABEL: Record<string, string> = {
  task_closed: "closed an action item",
  milestone_closed: "completed a milestone",
  roadblock_added: "raised a roadblock",
  note_added: "left a note",
};

async function reviewAndNotify(
  submissionId: string | undefined,
  opts: {
    projectId: string; memberName: string;
    kind: string; subject: string; note?: string;
  }
) {
  const p = await getProject(opts.projectId);
  if (!p) return;

  let summary = "";

  // Ask Gemini what this update actually means for the project.
  if (process.env.GEMINI_API_KEY) {
    try {
      const { data: settings } = await db
        .from("settings").select("analysis_prompt").eq("id", 1).single();

      const open = p.roadblocks.filter((r) => r.status !== "resolved");
      const prompt = `A team member just submitted an update through their project link.
Read it and tell the manager, in two or three sentences of plain prose, what it means:
whether the project moved forward, whether something now needs the manager's attention,
and what the sensible next step is. No headings, no bullets, no preamble. If it is a
routine completion with nothing else to say, say so briefly rather than inflating it.
${settings?.analysis_prompt ? "\nThe manager has also asked you to keep this in mind:\n" + settings.analysis_prompt : ""}

Project: ${p.title} — now ${p.percent}% complete, phase "${p.phase ?? "not set"}"
Open roadblocks on the project: ${open.length}${open.length ? " (" + open.map((r) => `${r.title} [${r.status}]`).join("; ") + ")" : ""}
Action items still open: ${p.tasks.filter((t) => !t.done).length}

The update:
${opts.memberName} ${KIND_LABEL[opts.kind] ?? "submitted an update"} — "${opts.subject}"
${opts.note ? `They wrote: "${opts.note}"` : "They left no note."}`;

      const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
          }),
        }
      );
      if (res.ok) {
        const json = await res.json();
        summary = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      }
    } catch { /* the notification still goes out without it */ }
  }

  if (submissionId && summary) {
    await db.from("submissions").update({ ai_summary: summary }).eq("id", submissionId);
  }

  // DM the manager. OWNER_CLIQ_EMAIL is who gets told; falls back to the
  // project owner if that isn't set.
  const notify = process.env.OWNER_CLIQ_EMAIL || p.owner?.email;
  if (notify) {
    const msg =
      `*${p.title}* — ${opts.memberName} ${KIND_LABEL[opts.kind] ?? "submitted an update"}: "${opts.subject}"` +
      (opts.note ? `\n\n_"${opts.note}"_` : "") +
      (summary ? `\n\n${summary}` : "") +
      `\n\nProject is now at ${p.percent}%.`;
    try { await cliqDM(notify, msg); } catch { /* badge still shows it */ }
  }

  await log(
    "submission",
    `${opts.memberName} ${KIND_LABEL[opts.kind] ?? "submitted"}: ${opts.subject}`,
    opts.projectId
  );
}

import { db, log } from "./supabase";
import { sendMail } from "./google";
import { analysePortfolio } from "./gemini";
import { getProjects } from "./data";
import { STATUS_COLUMNS } from "./types";
import { formatDateInZone, formatInZone, zoneToday, TZ } from "./tz";

const LIVE = ["todo", "pending", "dev", "testing"];

function esc(s: string) {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

function bar(pct: number) {
  return `
    <div style="height:6px;background:#e6ebe8;border-radius:3px;overflow:hidden;width:120px;">
      <div style="height:6px;width:${pct}%;background:#3f7a5c;border-radius:3px;"></div>
    </div>`;
}

export async function buildDigest() {
  const settings = (await db.from("settings").select("*").eq("id", 1).single()).data;
  const sections = settings?.digest_sections ?? {};
  const projects = await getProjects();
  const active = projects.filter((p) => LIVE.includes(p.status));

  const today = zoneToday();
  const openBlocks = projects.flatMap((p) =>
    p.roadblocks
      .filter((r) => r.status !== "resolved")
      .map((r) => ({ ...r, project: p.title, ref: p.ref }))
  );
  const overdue = projects.flatMap((p) =>
    p.tasks
      .filter((t) => !t.done && t.due_date && t.due_date < today)
      .map((t) => ({ ...t, project: p.title }))
  );
  const upcoming = projects.filter(
    (p) => p.due_date && p.due_date >= today &&
      new Date(p.due_date).getTime() - Date.now() < 7 * 86_400_000
  );

  let ai = "";
  if (sections.ai !== false && process.env.GEMINI_API_KEY) {
    try {
      ai = await analysePortfolio(
        active.map((p) => ({
          title: p.title,
          percent: p.percent,
          status: STATUS_COLUMNS.find((c) => c.key === p.status)?.label ?? p.status,
          openRoadblocks: p.roadblocks.filter((r) => r.status !== "resolved").length,
          escalated: p.roadblocks.filter((r) => r.status === "escalated").length,
          overdueTasks: p.tasks.filter((t) => !t.done && t.due_date && t.due_date < today).length,
          due_date: p.due_date,
        })),
        settings?.digest_prompt
      );
    } catch { /* the digest still goes out without it */ }
  }

  const dateLabel = formatInZone(new Date(), {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const html = `
<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;color:#16241d;background:#f7f8f7;padding:28px;">
  <div style="background:#ffffff;border:1px solid #e6ebe8;border-radius:14px;padding:28px;">

    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6b8177;font-weight:700;">ECE</div>
    <h1 style="font-size:20px;margin:6px 0 2px;font-weight:600;">Weekly project update</h1>
    <div style="font-size:13px;color:#6b8177;margin-bottom:24px;">${dateLabel}</div>

    <div style="display:flex;gap:24px;padding:16px 0;border-top:1px solid #eef1ef;border-bottom:1px solid #eef1ef;margin-bottom:24px;">
      <div><div style="font-size:22px;font-weight:600;">${active.length}</div><div style="font-size:11px;color:#6b8177;">Active</div></div>
      <div><div style="font-size:22px;font-weight:600;color:${openBlocks.length ? "#b8453a" : "#16241d"};">${openBlocks.length}</div><div style="font-size:11px;color:#6b8177;">Roadblocks</div></div>
      <div><div style="font-size:22px;font-weight:600;color:${overdue.length ? "#d97b1f" : "#16241d"};">${overdue.length}</div><div style="font-size:11px;color:#6b8177;">Overdue</div></div>
    </div>

    ${ai ? `
    <div style="background:#1d2b23;color:rgba(255,255,255,.86);border-radius:12px;padding:18px 20px;margin-bottom:26px;font-size:13px;line-height:1.65;">
      ${esc(ai).split("\n").filter(Boolean).map((l) => `<p style="margin:0 0 10px;">${l}</p>`).join("")}
      <div style="font-size:10px;color:rgba(255,255,255,.45);margin-top:6px;">Written by Gemini from this week's data</div>
    </div>` : ""}

    ${sections.progress !== false && active.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 12px;">Progress</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:26px;">
      ${active.map((p) => `
        <tr style="border-bottom:1px solid #eef1ef;">
          <td style="padding:10px 0;font-size:13px;font-weight:500;">${esc(p.title)}
                      </td>
          <td style="padding:10px 0;text-align:right;width:150px;">
            <div style="display:inline-flex;align-items:center;gap:9px;">
              ${bar(p.percent)}
              <span style="font-size:12px;color:#3d5249;min-width:30px;">${p.percent}%</span>
            </div>
          </td>
        </tr>`).join("")}
    </table>` : ""}

    ${sections.roadblocks !== false && openBlocks.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 12px;">Roadblocks</h2>
    ${openBlocks.map((r) => {
      const c = r.status === "escalated" ? "#5f4f87" : r.status === "progress" ? "#d97b1f" : "#b8453a";
      return `
      <div style="border-left:3px solid ${c};background:#fafbfa;border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;">
        <div style="font-size:11px;color:#6b8177;">${esc(r.project)}</div>
        <div style="font-size:13px;font-weight:600;margin:2px 0 4px;">${esc(r.title)}</div>
        <div style="font-size:12px;color:#3d5249;line-height:1.55;">${esc(r.detail)}</div>
        <div style="font-size:11px;color:#6b8177;margin-top:6px;">
          ${esc(r.owner?.name ?? "unassigned")} · raised ${formatDateInZone(r.raised_at)}
        </div>
      </div>`;
    }).join("")}
    <div style="height:18px;"></div>` : ""}

    ${sections.overdue !== false && overdue.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 12px;">Overdue</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:26px;">
      ${overdue.map((t) => `
        <tr style="border-bottom:1px solid #eef1ef;">
          <td style="padding:9px 0;font-size:13px;">${esc(t.name)}
            <div style="font-size:11px;color:#6b8177;">${esc(t.project)} · ${esc(t.assignees?.map((a) => a.name).join(", ") || "unassigned")}</div>
          </td>
          <td style="padding:9px 0;text-align:right;font-size:12px;color:#b8453a;">${t.due_date}</td>
        </tr>`).join("")}
    </table>` : ""}

    ${upcoming.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 12px;">Due in the next week</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      ${upcoming.map((p) => `
        <tr style="border-bottom:1px solid #eef1ef;">
          <td style="padding:9px 0;font-size:13px;">${esc(p.title)}</td>
          <td style="padding:9px 0;text-align:right;font-size:12px;color:#3d5249;">${p.due_date} · ${p.percent}%</td>
        </tr>`).join("")}
    </table>` : ""}

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eef1ef;">
      <a href="${process.env.APP_URL}" style="display:inline-block;background:#1d2b23;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;">Open the board</a>
    </div>
  </div>
</div>`;

  const subject =
    openBlocks.length > 0
      ? `Weekly project update — ${active.length} active, ${openBlocks.length} blocked`
      : `Weekly project update — ${active.length} active`;

  return { subject, html, recipients: settings?.digest_recipients ?? [] };
}

export async function sendDigest(overrideTo?: string[]) {
  const { subject, html, recipients } = await buildDigest();
  const to = overrideTo?.length ? overrideTo : recipients;
  if (!to.length) return { sent: false, reason: "no recipients configured" };

  await sendMail(to, subject, html);
  await log("digest", `Weekly digest sent to ${to.length} recipient(s)`);
  return { sent: true, to };
}

// ─────────────────────────────────────────────────────────
// Per-project weekly email (additive — separate from the
// portfolio digest above).
// ─────────────────────────────────────────────────────────
import { getProject } from "./data";

/** MM/DD/YYYY in the app timezone, for the {date} token in email subjects. */
function fmtDate(_d?: Date) {
  const [y, m, dd] = zoneToday().split("-");
  return `${m}/${dd}/${y}`;
}

export async function buildProjectEmail(projectId: string) {
  const p = await getProject(projectId);
  if (!p) throw new Error("project not found");

  const settings = (await db.from("settings").select("*").eq("id", 1).single()).data;
  const sections = settings?.digest_sections ?? {};
  const today = zoneToday();

  const open = p.roadblocks.filter((r) => r.status !== "resolved");
  const overdue = p.tasks.filter((t) => !t.done && t.due_date && t.due_date < today);

  let ai = "";
  if (sections.ai !== false && process.env.GEMINI_API_KEY) {
    try {
      const { analyseProject } = await import("./gemini");
      ai = await analyseProject({
        title: p.title, status: p.status, phase: p.phase, percent: p.percent, due_date: p.due_date,
        milestones: p.milestones.map((m) => ({ name: m.name, done: m.done, note: m.note })),
        roadblocks: p.roadblocks.map((r) => ({
          title: r.title, detail: r.detail, status: r.status,
          raised_at: r.raised_at, owner: r.owner?.name ?? "unassigned",
        })),
        tasks: p.tasks.map((t) => ({
          name: t.name, done: t.done, due_date: t.due_date, assignee: t.assignees?.map((a) => a.name).join(", ") || "unassigned",
        })),
      }, settings?.digest_prompt);
    } catch { /* still send without it */ }
  }

  const dateStr = fmtDate(new Date());
  const subjectTemplate = p.email_subject || "{project}_Weekly update {date}";
  const subject = subjectTemplate
    .replace(/{project}/g, p.title)
    .replace(/{date}/g, dateStr);

  const doneCount = p.milestones.filter((m) => m.done).length;

  const html = `
<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;color:#16241d;background:#f7f8f7;padding:28px;">
  <div style="background:#fff;border:1px solid #e6ebe8;border-radius:14px;padding:28px;">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6b8177;font-weight:700;">ECE</div>
    <h1 style="font-size:20px;margin:6px 0 2px;font-weight:600;">${esc(p.title)}</h1>
    <div style="font-size:13px;color:#6b8177;margin-bottom:22px;">Weekly update · ${dateStr}</div>

    <div style="display:flex;gap:24px;padding:16px 0;border-top:1px solid #eef1ef;border-bottom:1px solid #eef1ef;margin-bottom:22px;">
      <div><div style="font-size:22px;font-weight:600;">${p.percent}%</div><div style="font-size:11px;color:#6b8177;">${doneCount}/${p.milestones.length} milestones</div></div>
      <div><div style="font-size:22px;font-weight:600;color:${open.length ? "#b8453a" : "#16241d"};">${open.length}</div><div style="font-size:11px;color:#6b8177;">Roadblocks</div></div>
      <div><div style="font-size:22px;font-weight:600;color:${overdue.length ? "#d97b1f" : "#16241d"};">${overdue.length}</div><div style="font-size:11px;color:#6b8177;">Overdue</div></div>
    </div>

    ${ai ? `<div style="background:#1d2b23;color:rgba(255,255,255,.86);border-radius:12px;padding:18px 20px;margin-bottom:22px;font-size:13px;line-height:1.65;">
      ${esc(ai).split("\n").filter(Boolean).map((l) => `<p style="margin:0 0 10px;">${l}</p>`).join("")}
    </div>` : ""}

    ${sections.roadblocks !== false && open.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 10px;">Roadblocks</h2>
    ${open.map((r) => {
      const c = r.status === "escalated" ? "#5f4f87" : r.status === "progress" ? "#d97b1f" : "#b8453a";
      return `<div style="border-left:3px solid ${c};background:#fafbfa;border-radius:0 8px 8px 0;padding:11px 13px;margin-bottom:7px;">
        <div style="font-size:13px;font-weight:600;">${esc(r.title)}</div>
        <div style="font-size:12px;color:#3d5249;line-height:1.55;margin-top:3px;">${esc(r.detail)}</div>
      </div>`;
    }).join("")}<div style="height:16px;"></div>` : ""}

    ${sections.overdue !== false && overdue.length ? `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#6b8177;margin:0 0 10px;">Overdue action items</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      ${overdue.map((t) => `<tr style="border-bottom:1px solid #eef1ef;">
        <td style="padding:8px 0;font-size:13px;">${esc(t.name)}<div style="font-size:11px;color:#6b8177;">${esc(t.assignees?.map((a) => a.name).join(", ") || "unassigned")}</div></td>
        <td style="padding:8px 0;text-align:right;font-size:12px;color:#b8453a;">${t.due_date}</td></tr>`).join("")}
    </table>` : ""}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eef1ef;">
      <a href="${process.env.APP_URL}" style="display:inline-block;background:#1d2b23;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;">Open the board</a>
    </div>
  </div>
</div>`;

  return { subject, html, to: p.email_to ?? [], cc: p.email_cc ?? [] };
}

export async function sendProjectEmail(projectId: string, overrideTo?: string[]) {
  const { subject, html, to, cc } = await buildProjectEmail(projectId);
  const recipients = overrideTo?.length ? overrideTo : to;
  if (!recipients.length) return { sent: false, reason: "no recipients set for this project" };

  const { sendMail } = await import("./google");
  await sendMail(recipients, subject, html, cc);
  await db.from("projects")
    .update({ email_last_sent: zoneToday() })
    .eq("id", projectId);
  await log("project_email", `Project email sent for ${projectId} to ${recipients.length} recipient(s)`);
  return { sent: true, to: recipients };
}

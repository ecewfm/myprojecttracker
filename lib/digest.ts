import { db, log } from "./supabase";
import { sendMail } from "./google";
import { analysePortfolio } from "./gemini";
import { getProjects } from "./data";
import { STATUS_COLUMNS } from "./types";
import { renderMarkdown } from "./markdown";
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

  // ── the email ──
  // Table-based with inline styles: Outlook ignores <ul>, flexbox and most
  // of a <style> block, so everything is laid out with tables.

  const bar = (percent: number, blocked: boolean) => `
    <table role="presentation" cellpadding="0" cellspacing="0" align="right">
      <tr>
        <td>
          <table role="presentation" width="110" cellpadding="0" cellspacing="0" style="background:#e6ebe8;border-radius:4px;">
            <tr><td style="background:${blocked ? "#b8453a" : "#3f7a5c"};border-radius:4px;height:7px;width:${Math.max(percent, 2)}%;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>
        </td>
        <td style="padding-left:9px;font-size:12px;font-weight:600;color:#3d5249;width:34px;">${percent}%</td>
      </tr>
    </table>`;

  const chip = (text: string, fg: string, bg: string, bd: string) =>
    `<span style="display:inline-block;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${fg};background:${bg};border:1px solid ${bd};border-radius:4px;padding:2px 6px;margin-left:7px;">${text}</span>`;

  const section = (label: string) => `
  <tr><td style="padding:26px 30px 4px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#6b8177;text-transform:uppercase;margin-bottom:12px;">${label}</div>
  </td></tr>`;

  // Most complete first, so whatever is lagging sits together at the bottom.
  const listed = [...active].sort((a, b) => b.percent - a.percent);
  const shown = listed.slice(0, 12);
  const hidden = listed.length - shown.length;

  const projectRows = shown.map((p, i) => {
    const blocked = p.roadblocks.some((r) => r.status !== "resolved");
    const late = !!p.due_date && p.due_date < today && p.percent < 100;
    const meta = [
      p.owner?.name,
      p.due_date ? `due ${formatDateInZone(p.due_date)}` : null,
    ].filter(Boolean).join(" &middot; ");

    return `
      <tr><td style="padding:11px 0;${i === shown.length - 1 ? "" : "border-bottom:1px solid #eef1ef;"}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle" style="font-size:13.5px;font-weight:600;color:#16241d;">
              ${esc(p.title)}
              ${p.priority ? chip("Priority", "#96540c", "#fdf0e0", "#f2d3ab") : ""}
              ${blocked ? chip("Blocked", "#8c2f26", "#fbeae8", "#edc4bf") : ""}
              ${late && !blocked ? chip("Late", "#8c2f26", "#fbeae8", "#edc4bf") : ""}
              ${meta ? `<div style="font-size:11px;color:#6b8177;font-weight:400;margin-top:3px;">${esc(meta)}</div>` : ""}
            </td>
            <td width="150" align="right" valign="middle">${bar(p.percent, blocked)}</td>
          </tr>
        </table>
      </td></tr>`;
  }).join("");

  const roadblockCards = openBlocks.map((r) => {
    const days = Math.max(0, Math.floor((Date.now() - new Date(r.raised_at).getTime()) / 86400000));
    const colour = r.status === "escalated" ? "#5f4f87" : r.status === "progress" ? "#8a5310" : "#8c2f26";
    const label = r.status === "progress" ? "In progress" : r.status === "escalated" ? "Escalated" : "Open";

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf7f6;border:1px solid #f0dedb;border-left:3px solid ${colour};border-radius:0 10px 10px 0;margin-bottom:8px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;color:#6b8177;margin-bottom:3px;">${esc(r.project)}</div>
        <div style="font-size:13.5px;font-weight:600;color:#16241d;margin-bottom:5px;">${esc(r.title)}</div>
        ${r.detail ? `<div style="font-size:12.5px;color:#3d5249;line-height:1.6;margin-bottom:8px;">${esc(r.detail)}</div>` : ""}
        <div style="font-size:11px;color:#6b8177;">
          ${esc(r.owner?.name ?? "Unassigned")} &middot; open ${days} day${days === 1 ? "" : "s"} &middot;
          <span style="color:${colour};font-weight:600;">${label}</span>
        </div>
      </td></tr>
    </table>`;
  }).join("");

  const soon = [
    ...overdue.map((t: any) => ({
      name: t.name,
      sub: `${t.project} &middot; ${t.assignees?.map((a: any) => a.name).join(", ") || "unassigned"}`,
      date: t.due_date as string,
      late: true,
    })),
    ...upcoming.map((p) => ({
      name: p.title,
      sub: "Project target date",
      date: p.due_date as string,
      late: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  const soonRows = soon.map((s, i) => {
    const edge = i === soon.length - 1 ? "" : "border-bottom:1px solid #eef1ef;";
    return `
    <tr>
      <td style="padding:9px 0;${edge}font-size:13px;color:#16241d;">
        ${esc(s.name)}
        <div style="font-size:11px;color:#6b8177;margin-top:2px;">${s.sub}</div>
      </td>
      <td align="right" style="padding:9px 0;${edge}font-size:12px;color:${s.late ? "#b8453a" : "#3d5249"};${s.late ? "font-weight:600;" : ""}white-space:nowrap;">
        ${formatDateInZone(s.date)}
      </td>
    </tr>`;
  }).join("");

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eeea;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center" style="padding:26px 12px;">
<table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#1d2b23;padding:26px 30px 22px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:.22em;color:#8fc9a8;text-transform:uppercase;">ECE</div>
    <div style="font-size:22px;font-weight:600;color:#ffffff;letter-spacing:-.02em;margin-top:8px;">Weekly project update</div>
    <div style="font-size:13px;color:#9ec4ad;margin-top:3px;">${dateLabel}</div>
  </td></tr>

  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="33.3%" style="padding:20px 10px;text-align:center;border-right:1px solid #eef1ef;border-bottom:1px solid #eef1ef;">
          <div style="font-size:26px;font-weight:600;color:#16241d;line-height:1;">${active.length}</div>
          <div style="font-size:11px;color:#6b8177;margin-top:5px;">Active projects</div>
        </td>
        <td width="33.3%" style="padding:20px 10px;text-align:center;border-right:1px solid #eef1ef;border-bottom:1px solid #eef1ef;">
          <div style="font-size:26px;font-weight:600;color:${openBlocks.length ? "#b8453a" : "#16241d"};line-height:1;">${openBlocks.length}</div>
          <div style="font-size:11px;color:#6b8177;margin-top:5px;">Roadblock${openBlocks.length === 1 ? "" : "s"}</div>
        </td>
        <td width="33.3%" style="padding:20px 10px;text-align:center;border-bottom:1px solid #eef1ef;">
          <div style="font-size:26px;font-weight:600;color:${overdue.length ? "#d97b1f" : "#16241d"};line-height:1;">${overdue.length}</div>
          <div style="font-size:11px;color:#6b8177;margin-top:5px;">Overdue</div>
        </td>
      </tr>
    </table>
  </td></tr>

  ${ai ? `
  ${section("This week, in short")}
  <tr><td style="padding:0 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f5;border-left:3px solid #3f7a5c;border-radius:0 10px 10px 0;">
      <tr><td style="padding:18px 20px;">${renderMarkdown(ai)}</td></tr>
    </table>
  </td></tr>` : ""}

  ${sections.progress !== false && shown.length ? `
  ${section("Where each project stands")}
  <tr><td style="padding:0 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${projectRows}</table>
    ${hidden > 0 ? `<div style="font-size:11.5px;color:#6b8177;padding-top:12px;">and ${hidden} more on the board</div>` : ""}
  </td></tr>` : ""}

  ${sections.roadblocks !== false && openBlocks.length ? `
  ${section("Needs your attention")}
  <tr><td style="padding:0 30px;">${roadblockCards}</td></tr>` : ""}

  ${soon.length ? `
  ${section("Due in the next seven days")}
  <tr><td style="padding:0 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${soonRows}</table>
  </td></tr>` : ""}

  <tr><td style="padding:28px 30px 30px;">
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr><td style="background:#1d2b23;border-radius:9px;">
        <a href="${process.env.APP_URL}" style="display:inline-block;padding:12px 22px;font-size:13.5px;font-weight:600;color:#ffffff;text-decoration:none;">Open the board</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f7faf8;padding:16px 30px;border-top:1px solid #eef1ef;">
    <div style="font-size:11px;color:#8a978f;line-height:1.6;">
      Sent from ECE Projects. Change the day, time or recipients in Settings.
    </div>
  </td></tr>

</table>
<div style="height:26px;"></div>
</td></tr>
</table>`;


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

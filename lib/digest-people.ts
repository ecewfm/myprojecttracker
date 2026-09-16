import { buildPeopleUpdate, type PersonBlock, type Status } from "./people-update";
import { db } from "./supabase";
import { formatInZone, zoneToday } from "./tz";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Colour by how much attention it wants. */
const TONE: Record<Status, [string, string, string]> = {
  Blocked:       ["#8c2f26", "#fbeae8", "#edc4bf"],
  Behind:        ["#8c2f26", "#fbeae8", "#edc4bf"],
  "For testing": ["#8a5310", "#fdf3e6", "#f0d9b8"],
  "In progress": ["#8a5310", "#fdf3e6", "#f0d9b8"],
  "On track":    ["#2f4f47", "#ecf5ef", "#cfe4d7"],
  Complete:      ["#2f4f47", "#ecf5ef", "#cfe4d7"],
};

const TH =
  "font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;" +
  "color:#8a978f;padding:0 8px 8px;border-bottom:1.5px solid #dfe7e2";

function pctCell(p: number | null, edge: string) {
  if (p === null) {
    return `<td align="right" valign="top" style="padding:12px 8px;${edge}font-size:11px;color:#c3ccc7;">&mdash;</td>`;
  }
  const fill = p < 40 ? "#b8453a" : "#3f7a5c";
  return `<td align="right" valign="top" style="padding:12px 8px;${edge}white-space:nowrap;">
    <div style="font-size:12px;font-weight:600;color:#3d5249;">${p}%</div>
    <table role="presentation" width="52" cellpadding="0" cellspacing="0" align="right" style="background:#e6ebe8;border-radius:3px;margin-top:4px;">
      <tr><td style="background:${fill};border-radius:3px;height:4px;width:${Math.max(p, 2)}%;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
  </td>`;
}

function personRows(b: PersonBlock) {
  return b.rows.map((r, i) => {
    const last = i === b.rows.length - 1;
    const edge = last ? "border-bottom:1px solid #eef1ef;" : "border-bottom:1px solid #f4f7f5;";
    const [fg, bg, bd] = TONE[r.status];

    const nameCell = i === 0
      ? `<td${b.rows.length > 1 ? ` rowspan="${b.rows.length}"` : ""} valign="top"
             style="padding:12px 8px 12px 0;border-bottom:1px solid #eef1ef;background:#fafcfb;">
           <div style="font-size:12.5px;font-weight:600;color:#16241d;line-height:1.35;">${esc(b.name)}</div>
           <div style="font-size:10px;color:#8a978f;margin-top:4px;">${esc(b.note)}</div>
         </td>`
      : "";

    return `
      <tr>
        ${nameCell}
        <td valign="top" style="padding:12px 8px;${edge}width:150px;">
          <div style="font-size:12px;font-weight:500;color:#16241d;line-height:1.4;">${esc(r.headline)}</div>
          ${r.description
            ? `<div style="font-size:10.5px;color:#8a978f;line-height:1.45;margin-top:3px;">${esc(r.description)}</div>`
            : ""}
        </td>
        <td valign="top" style="padding:12px 8px;${edge}font-size:11.5px;color:#3d5249;line-height:1.55;">
          ${r.impact ? esc(r.impact) : `<span style="color:#c3ccc7;">no line written yet</span>`}
        </td>
        ${pctCell(r.percent, edge)}
        <td valign="top" style="padding:12px 0 12px 8px;${edge}">
          <span style="display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.03em;color:${fg};background:${bg};border:1px solid ${bd};border-radius:4px;padding:2px 7px;white-space:nowrap;">${r.status.toUpperCase()}</span>
        </td>
      </tr>`;
  }).join("");
}

export async function buildPeopleDigest() {
  const { people, idle, unassigned } = await buildPeopleUpdate();
  const { data: settings } = await db
    .from("settings").select("digest_recipients").eq("id", 1).single();

  const dateLabel = formatInZone(new Date(), {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const projectCount = new Set(people.flatMap((p) => p.rows.map((r) => r.projectId))).size;

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eeea;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center" style="padding:26px 10px;">
<table role="presentation" width="860" cellpadding="0" cellspacing="0" style="max-width:860px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">

  <tr><td style="background:#1d2b23;padding:20px 24px 17px;">
    <div style="font-size:9.5px;font-weight:700;letter-spacing:.22em;color:#8fc9a8;text-transform:uppercase;">ECE</div>
    <div style="font-size:19px;font-weight:600;color:#ffffff;letter-spacing:-.02em;margin-top:6px;">WFM AI Projects &mdash; weekly update</div>
    <div style="font-size:12px;color:#9ec4ad;margin-top:2px;">${dateLabel} &middot; ${people.length} people &middot; ${projectCount} projects</div>
  </td></tr>

  <tr><td style="padding:16px 16px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <th align="left"  style="${TH};padding-left:0;width:118px;">Programmer</th>
        <th align="left"  style="${TH};width:150px;">Currently working on</th>
        <th align="left"  style="${TH}">How it's impacting the business</th>
        <th align="right" style="${TH};width:60px;">Complete</th>
        <th align="left"  style="${TH};padding-right:0;width:84px;">Status</th>
      </tr>
      ${people.map(personRows).join("")}
    </table>
  </td></tr>

  ${unassigned ? `
  <tr><td style="padding:6px 16px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf7f6;border-left:3px solid #b8453a;border-radius:0 8px 8px 0;">
      <tr><td style="padding:10px 13px;font-size:11.5px;color:#3d5249;line-height:1.55;">
        <b style="color:#16241d;">${unassigned} items have nobody assigned.</b>
        Nothing is reminding anyone about them.
      </td></tr>
    </table>
  </td></tr>` : ""}

  ${idle.length ? `
  <tr><td style="padding:10px 16px 0;">
    <div style="font-size:10.5px;color:#8a978f;line-height:1.6;">
      Nothing open this week: ${esc(idle.join(", "))}.
    </div>
  </td></tr>` : ""}

  <tr><td style="padding:16px 24px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#1d2b23;border-radius:8px;">
        <a href="${process.env.APP_URL}" style="display:inline-block;padding:10px 18px;font-size:12.5px;font-weight:600;color:#ffffff;text-decoration:none;">Open the board</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#f7faf8;padding:12px 24px;border-top:1px solid #eef1ef;">
    <div style="font-size:10.5px;color:#8a978f;line-height:1.6;">
      Sent from WFM AI Projects. Change the day, time or recipients in Settings.
    </div>
  </td></tr>

</table>
<div style="height:26px;"></div>
</td></tr>
</table>`;

  const behind = people.filter((p) => p.rows.some((r) => r.status === "Blocked" || r.status === "Behind")).length;
  const subject = behind
    ? `WFM AI Projects — ${people.length} people, ${behind} needing attention`
    : `WFM AI Projects — ${people.length} people, all moving`;

  return { subject, html, recipients: settings?.digest_recipients ?? [] };
}

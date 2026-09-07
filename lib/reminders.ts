import { db, log } from "./supabase";
import { cliqDM, cliqChannel } from "./zoho";
import { ensureShareUrl } from "./ensure-link";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function manilaNow() {
  return new Date(Date.now() + MANILA_OFFSET_MS);
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date + "T00:00:00Z").getTime();
  const today = new Date(manilaNow().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((target - today) / 86_400_000);
}

function hoursSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * How many hours must pass before this item is nudged again.
 * Base cadence until the deadline is close, then the escalated cadence.
 */
function intervalHours(
  settings: any,
  daysLeft: number | null,
  isRoadblock: boolean
): number {
  const escalating =
    daysLeft !== null && daysLeft <= (settings.escalate_within_days ?? 3);

  if (escalating || isRoadblock) {
    switch (settings.reminder_escalated) {
      case "every_4h": return 4;
      case "hourly":   return 1;
      default:         return 12;   // twice daily
    }
  }
  switch (settings.reminder_base) {
    case "2days":    return 48;
    case "weekdays": return 24;     // the cron only runs Mon-Fri
    default:         return 24;
  }
}

function isWeekday() {
  const d = manilaNow().getUTCDay();
  return d >= 1 && d <= 5;
}

function taskMessage(t: any, daysLeft: number | null, url: string | null) {
  const p = t.projects;
  let body: string;

  if (daysLeft !== null && daysLeft < 0)
    body = `*${p.title}* — "${t.name}" was due ${t.due_date} and is still open. ` +
           `Can you close it out or tell me what it needs?`;
  else if (daysLeft === 0)
    body = `*${p.title}* — "${t.name}" is due today.`;
  else if (daysLeft !== null)
    body = `*${p.title}* — "${t.name}" is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${t.due_date}).`;
  else
    body = `*${p.title}* — "${t.name}" is still open. Any movement?`;

  // Repeat the link every time — people lose the original DM, and a
  // reminder without a way to act on it just becomes noise.
  return url ? `${body}\n\nClose it here:\n${url}` : body;
}

function milestoneMessage(m: any, daysLeft: number | null, url: string | null) {
  const p = m.projects;
  let body: string;

  if (daysLeft !== null && daysLeft < 0)
    body = `*${p.title}* — milestone "${m.name}" was due ${m.due_date} and isn't marked complete. ` +
           `Can you close it or tell me what's left?`;
  else if (daysLeft === 0)
    body = `*${p.title}* — milestone "${m.name}" is due today.`;
  else if (daysLeft !== null)
    body = `*${p.title}* — milestone "${m.name}" is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${m.due_date}).`;
  else
    body = `*${p.title}* — milestone "${m.name}" is still open. Any movement?`;

  return url ? `${body}\n\nMark it complete here:\n${url}` : body;
}

function roadblockMessage(r: any, url: string | null) {
  const days = Math.floor(hoursSince(r.raised_at) / 24);
  const age = days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;

  const body = r.status === "escalated"
    ? `*${r.projects.title}* — escalated roadblock: "${r.title}". ` +
      `Raised ${age} and still open. This one needs a decision, not a status update.`
    : `*${r.projects.title}* — roadblock still open: "${r.title}" (raised ${age}). ` +
      `Update the status when it moves.`;

  return url ? `${body}\n\nProject view:\n${url}` : body;
}

/** Runs from the cron route. Returns a summary of what it sent. */
export async function runReminders() {
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  if (!settings) return { sent: 0, skipped: "no settings row" };

  if (settings.reminder_base === "weekdays" && !isWeekday()) {
    return { sent: 0, skipped: "weekend" };
  }

  let sent = 0;
  const failures: string[] = [];

  // ── Open action items ───────────────────────────────
  const { data: tasks } = await db
    .from("tasks")
    .select(`
      id, name, due_date, last_nudge_at, nudge_count,
      assignee:team_members!tasks_assignee_id_fkey ( id, name, email ),
      projects!inner ( id, title, reminders_on, archived )
    `)
    .eq("done", false);

  for (const t of (tasks ?? []) as any[]) {
    if (!t.assignee?.email) continue;
    if (!t.projects?.reminders_on || t.projects.archived) continue;

    const daysLeft = daysUntil(t.due_date);
    const wait = intervalHours(settings, daysLeft, false);
    if (hoursSince(t.last_nudge_at) < wait) continue;

    try {
      const url = await ensureShareUrl(t.projects.id, t.assignee.id);
      await cliqDM(t.assignee.email, taskMessage(t, daysLeft, url));
      await db.from("tasks")
        .update({ last_nudge_at: new Date().toISOString(), nudge_count: t.nudge_count + 1 })
        .eq("id", t.id);
      await log("cliq_dm", `Task reminder to ${t.assignee.name} — ${t.name}`, t.projects.id);
      sent++;

      // Unanswered three times running: raise it in the channel.
      if (
        settings.mention_in_group &&
        t.nudge_count + 1 >= 3 &&
        process.env.CLIQ_GROUP_CHANNEL
      ) {
        await cliqChannel(
          process.env.CLIQ_GROUP_CHANNEL,
          `@${t.assignee.email} — "${t.name}" on *${t.projects.title}* has been open through ` +
          `${t.nudge_count + 1} reminders. Flagging here so it doesn't sit.`
        );
      }
    } catch (e: any) {
      failures.push(`task ${t.id}: ${e.message}`);
    }
  }

  // ── Open milestones with a deadline ─────────────────
  // Same escalating cadence as action items. Only milestones with both an
  // assignee and a due date are chased; the rest are just checklist items.
  const { data: mstones } = await db
    .from("milestones")
    .select(`
      id, name, due_date, last_nudge_at, nudge_count,
      assignee:team_members!milestones_assignee_id_fkey ( id, name, email ),
      projects!inner ( id, title, reminders_on, archived )
    `)
    .eq("done", false)
    .not("due_date", "is", null);

  for (const m of (mstones ?? []) as any[]) {
    if (!m.assignee?.email) continue;
    if (!m.projects?.reminders_on || m.projects.archived) continue;

    const daysLeft = daysUntil(m.due_date);
    const wait = intervalHours(settings, daysLeft, false);
    if (hoursSince(m.last_nudge_at) < wait) continue;

    try {
      const url = await ensureShareUrl(m.projects.id, m.assignee.id);
      await cliqDM(m.assignee.email, milestoneMessage(m, daysLeft, url));
      await db.from("milestones")
        .update({ last_nudge_at: new Date().toISOString(), nudge_count: m.nudge_count + 1 })
        .eq("id", m.id);
      await log("cliq_dm", `Milestone reminder to ${m.assignee.name} — ${m.name}`, m.projects.id);
      sent++;
    } catch (e: any) {
      failures.push(`milestone ${m.id}: ${e.message}`);
    }
  }

  // ── Open roadblocks ─────────────────────────────────
  if (settings.nudge_open_roadblocks) {
    const { data: blocks } = await db
      .from("roadblocks")
      .select(`
        id, title, detail, status, raised_at, target_date, last_nudge_at, nudge_count,
        owner:team_members!roadblocks_owner_id_fkey ( id, name, email ),
        projects!inner ( id, title, reminders_on, archived )
      `)
      .neq("status", "resolved");

    for (const r of (blocks ?? []) as any[]) {
      if (!r.owner?.email) continue;
      if (!r.projects?.reminders_on || r.projects.archived) continue;

      const wait = intervalHours(settings, daysUntil(r.target_date), true);
      if (hoursSince(r.last_nudge_at) < wait) continue;

      try {
        const url = await ensureShareUrl(r.projects.id, r.owner.id);
        await cliqDM(r.owner.email, roadblockMessage(r, url));
        await db.from("roadblocks")
          .update({ last_nudge_at: new Date().toISOString(), nudge_count: r.nudge_count + 1 })
          .eq("id", r.id);
        await log("cliq_dm", `Roadblock nudge to ${r.owner.name} — ${r.title}`, r.projects.id);
        sent++;
      } catch (e: any) {
        failures.push(`roadblock ${r.id}: ${e.message}`);
      }
    }
  }

  return { sent, failures };
}

/** Fired the moment a roadblock is created or escalated. */
export async function notifyRoadblock(
  roadblockId: string,
  kind: "opened" | "escalated"
) {
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  if (kind === "opened" && !settings?.notify_on_roadblock) return;

  const { data: r } = await db
    .from("roadblocks")
    .select(`
      id, title, detail, status, owner_id,
      owner:team_members!roadblocks_owner_id_fkey ( name, email ),
      projects ( id, title, owner:team_members!projects_owner_id_fkey ( name, email ) )
    `)
    .eq("id", roadblockId)
    .single();

  if (!r) return;
  const rb = r as any;
  const recipients = new Set<string>();
  if (rb.owner?.email) recipients.add(rb.owner.email);
  if (kind === "escalated" && settings?.copy_manager && rb.projects?.owner?.email) {
    recipients.add(rb.projects.owner.email);
  }

  // Owner gets a link so they can see the project context.
  const ownerLink = rb.owner_id
    ? await ensureShareUrl(rb.projects.id, rb.owner_id)
    : null;

  const text =
    (kind === "escalated"
      ? `*${rb.projects.title}* — roadblock escalated: "${rb.title}"\n${rb.detail}\n` +
        `Escalated because it isn't moving at the working level.`
      : `*${rb.projects.title}* — new roadblock assigned to you: "${rb.title}"\n${rb.detail}\n` +
        `You'll get a nudge here until the status changes.`) +
    (ownerLink ? `\n\nProject view:\n${ownerLink}` : "");

  for (const email of recipients) {
    try {
      await cliqDM(email, text);
    } catch { /* logged below in aggregate */ }
  }

  await log(
    "roadblock",
    `Roadblock ${kind}: ${rb.title} — notified ${recipients.size} person(s)`,
    rb.projects?.id
  );
}

/** Fired when someone is newly assigned to a task. */
export async function notifyAssignment(taskId: string) {
  const { data: t } = await db
    .from("tasks")
    .select(`
      id, name, due_date, assignee_id,
      assignee:team_members!tasks_assignee_id_fkey ( name, email ),
      projects ( id, title )
    `)
    .eq("id", taskId)
    .single();

  const task = t as any;
  if (!task?.assignee?.email) return;

  // Make sure they have a way to close it before telling them about it.
  const url = await ensureShareUrl(task.projects.id, task.assignee_id);

  await cliqDM(
    task.assignee.email,
    `*${task.projects.title}* — you've been assigned: "${task.name}"` +
      (task.due_date ? `\nDue ${task.due_date}.` : "") +
      (url
        ? `\n\nMark it done here when you're finished:\n${url}`
        : `\nI'll follow up here until it's closed.`)
  );
  await log(
    "cliq_dm",
    `Assignment sent to ${task.assignee.name} — ${task.name}`,
    task.projects.id
  );
}

/** Fired when someone is newly assigned to a milestone. */
export async function notifyMilestoneAssignment(milestoneId: string) {
  const { data: m } = await db
    .from("milestones")
    .select(`
      id, name, assignee_id,
      assignee:team_members!milestones_assignee_id_fkey ( name, email ),
      projects ( id, title )
    `)
    .eq("id", milestoneId)
    .single();

  const ms = m as any;
  if (!ms?.assignee?.email) return;

  const url = await ensureShareUrl(ms.projects.id, ms.assignee_id);

  await cliqDM(
    ms.assignee.email,
    `*${ms.projects.title}* — milestone assigned to you: "${ms.name}"` +
      (url ? `\n\nMark it complete here when it's done:\n${url}` : "")
  );
  await log(
    "cliq_dm",
    `Milestone assigned to ${ms.assignee.name} — ${ms.name}`,
    ms.projects.id
  );
}

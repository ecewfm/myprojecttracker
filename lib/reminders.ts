import { db, log } from "./supabase";
import { cliqDM, cliqChannel } from "./zoho";
import { ensureShareUrl } from "./ensure-link";
import { DigestBatch } from "./digest-batch";
import { daysUntilInZone, isWeekdayInZone, zoneHour } from "./tz";

// Day maths runs in the app's timezone (see lib/tz.ts), so "due today"
// and "weekdays only" mean what they should wherever the server runs.
const daysUntil = (date: string | null) => daysUntilInZone(date);

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

  if (settings.reminder_base === "weekdays" && !isWeekdayInZone()) {
    return { sent: 0, skipped: "weekend" };
  }

  // The cron fires every hour so daylight saving never shifts the schedule.
  // Reminders only go out during working hours in the app timezone, and the
  // per-item interval check below stops anyone being messaged repeatedly.
  // Reminders go out at set times, not "any hour the interval happens to
  // elapse". The cron still runs hourly; everything else is ignored.
  //
  //   dm_start_hour  the daily send — every open item, once
  //   dm_end_hour    a second pass, escalated items only
  //
  // Anything not escalating is therefore messaged exactly once a day.
  const hour = zoneHour();
  const primaryHour = settings.dm_start_hour ?? 9;
  const secondHour = settings.dm_end_hour ?? 16;
  const isPrimary = hour === primaryHour;
  const isSecond = hour === secondHour && secondHour !== primaryHour;

  if (!isPrimary && !isSecond) {
    return {
      sent: 0,
      skipped: `not a send time (now ${hour}:00; sends at ${primaryHour}:00` +
        (secondHour !== primaryHour ? ` and ${secondHour}:00 for escalated items` : "") + ")",
    };
  }

  /** Is this item on the escalated cadence right now? */
  const escalating = (daysLeft: number | null, isRoadblock: boolean) =>
    isRoadblock ||
    (daysLeft !== null && daysLeft <= (settings.escalate_within_days ?? 3));

  /**
   * Whether an item is due a message in this slot.
   *
   * On the primary pass the configured interval applies, so "every other day"
   * really does skip a day. On the second pass the slot itself is the limit —
   * it happens once daily and only takes escalated items — so we just guard
   * against double-sending to someone who was messaged minutes ago.
   */
  const due = (lastNudge: string | null, daysLeft: number | null, isRoadblock: boolean) => {
    const since = hoursSince(lastNudge);
    if (isSecond) return since >= 4;
    // An hour of tolerance: a run at exactly 24.0h should not be skipped.
    return since >= intervalHours(settings, daysLeft, isRoadblock) - 1;
  };

  let sent = 0;
  const failures: string[] = [];

  // Everything open for one person on one project goes out as a single
  // message. Roadblocks stay separate — those are urgent enough on their own.
  const batch = new DigestBatch();

  // ── Open action items ───────────────────────────────
  // An item can have several assignees. Each is nudged on their own
  // schedule, so one person going quiet doesn't stop the others hearing.
  const { data: taskRows } = await db
    .from("task_assignees")
    .select(`
      member_id, last_nudge_at, nudge_count,
      team_members ( id, name, email ),
      tasks!inner (
        id, name, due_date, done,
        projects!inner ( id, title, reminders_on, archived )
      )
    `);

  for (const row of (taskRows ?? []) as any[]) {
    const t = row.tasks, who = row.team_members;
    if (!t || t.done || !who?.email) continue;
    if (!t.projects?.reminders_on || t.projects.archived) continue;

    const daysLeft = daysUntil(t.due_date);
    const hot = escalating(daysLeft, false);
    // The second pass is for escalated items only.
    if (isSecond && !hot) continue;
    if (!due(row.last_nudge_at, daysLeft, false)) continue;

    try {
      batch.add(t.projects.id, who.id, {
        kind: "task",
        name: t.name,
        due: t.due_date,
      });
      await db.from("task_assignees")
        .update({ last_nudge_at: new Date().toISOString(), nudge_count: row.nudge_count + 1 })
        .eq("task_id", t.id).eq("member_id", who.id);

      if (settings.mention_in_group && row.nudge_count + 1 >= 3 && process.env.CLIQ_GROUP_CHANNEL) {
        await cliqChannel(
          process.env.CLIQ_GROUP_CHANNEL,
          `@${who.email} — "${t.name}" on *${t.projects.title}* has been open through ` +
          `${row.nudge_count + 1} reminders. Flagging here so it doesn't sit.`
        );
      }
    } catch (e: any) {
      failures.push(`task ${t.id}/${who.id}: ${e.message}`);
    }
  }

  // ── Open milestones with a deadline ─────────────────
  // Same escalating cadence as action items. Only milestones with both an
  // assignee and a due date are chased; the rest are just checklist items.
  const { data: msRows } = await db
    .from("milestone_assignees")
    .select(`
      member_id, last_nudge_at, nudge_count,
      team_members ( id, name, email ),
      milestones!inner (
        id, name, due_date, done,
        projects!inner ( id, title, reminders_on, archived )
      )
    `);

  for (const row of (msRows ?? []) as any[]) {
    const m = row.milestones, who = row.team_members;
    if (!m || m.done || !m.due_date || !who?.email) continue;
    if (!m.projects?.reminders_on || m.projects.archived) continue;

    const daysLeft = daysUntil(m.due_date);
    const hot = escalating(daysLeft, false);
    if (isSecond && !hot) continue;
    if (!due(row.last_nudge_at, daysLeft, false)) continue;

    try {
      batch.add(m.projects.id, who.id, {
        kind: "milestone",
        name: m.name,
        due: m.due_date,
      });
      await db.from("milestone_assignees")
        .update({ last_nudge_at: new Date().toISOString(), nudge_count: row.nudge_count + 1 })
        .eq("milestone_id", m.id).eq("member_id", who.id);
    } catch (e: any) {
      failures.push(`milestone ${m.id}/${who.id}: ${e.message}`);
    }
  }

  // ── Open roadblocks ─────────────────────────────────
  if (settings.nudge_open_roadblocks) {
    // One nudge per owner, each on their own clock.
    const { data: blockRows } = await db
      .from("roadblock_owners")
      .select(`
        member_id, last_nudge_at, nudge_count,
        team_members ( id, name, email ),
        roadblocks!inner (
          id, title, detail, status, raised_at, target_date,
          projects!inner ( id, title, reminders_on, archived )
        )
      `);

    for (const row of (blockRows ?? []) as any[]) {
      const r = row.roadblocks, who = row.team_members;
      if (!r || r.status === "resolved" || !who?.email) continue;
      if (!r.projects?.reminders_on || r.projects.archived) continue;

      if (!due(row.last_nudge_at, daysUntil(r.target_date), true)) continue;

      try {
        const url = await ensureShareUrl(r.projects.id, who.id);
        await cliqDM(who.email, roadblockMessage({ ...r, projects: r.projects }, url));
        await db.from("roadblock_owners")
          .update({ last_nudge_at: new Date().toISOString(), nudge_count: row.nudge_count + 1 })
          .eq("roadblock_id", r.id).eq("member_id", who.id);
        await log("cliq_dm", `Roadblock nudge to ${who.name} — ${r.title}`, r.projects.id);
        sent++;
      } catch (e: any) {
        failures.push(`roadblock ${r.id}/${who.id}: ${e.message}`);
      }
    }
  }

  // Send the collected reminders — one message per person per project.
  sent += await batch.flush("still open for you");

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
      id, title, detail, status,
      roadblock_owners ( team_members ( id, name, email ) ),
      projects ( id, title, owner:team_members!projects_owner_id_fkey ( name, email ) )
    `)
    .eq("id", roadblockId)
    .single();

  if (!r) return;
  const rb = r as any;
  const recipients = new Set<string>();
  for (const o of rb.roadblock_owners ?? []) {
    if (o.team_members?.email) recipients.add(o.team_members.email);
  }
  if (kind === "escalated" && settings?.copy_manager && rb.projects?.owner?.email) {
    recipients.add(rb.projects.owner.email);
  }

  // The first owner's link works for the project, which is what matters.
  const firstOwner = (rb.roadblock_owners ?? [])[0]?.team_members?.id;
  const ownerLink = firstOwner
    ? await ensureShareUrl(rb.projects.id, firstOwner)
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
export async function notifyAssignment(taskId: string, memberId: string) {
  const [{ data: t }, { data: who }] = await Promise.all([
    db.from("tasks").select("id, name, due_date, projects ( id, title )").eq("id", taskId).single(),
    db.from("team_members").select("id, name, email").eq("id", memberId).single(),
  ]);

  const task = t as any;
  if (!task || !who?.email) return;

  // Make sure they have a way to close it before telling them about it.
  const url = await ensureShareUrl(task.projects.id, memberId);

  await cliqDM(
    who.email,
    `*${task.projects.title}* — you've been assigned: "${task.name}"` +
      (task.due_date ? `\nDue ${task.due_date}.` : "") +
      (url
        ? `\n\nMark it done here when you're finished:\n${url}`
        : `\nI'll follow up here until it's closed.`)
  );
  await log("cliq_dm", `Assignment sent to ${who.name} — ${task.name}`, task.projects.id);
}

/** Fired when someone is newly assigned to a milestone. */
export async function notifyMilestoneAssignment(milestoneId: string, memberId: string) {
  const [{ data: m }, { data: who }] = await Promise.all([
    db.from("milestones").select("id, name, due_date, projects ( id, title )").eq("id", milestoneId).single(),
    db.from("team_members").select("id, name, email").eq("id", memberId).single(),
  ]);

  const ms = m as any;
  if (!ms || !who?.email) return;

  const url = await ensureShareUrl(ms.projects.id, memberId);

  await cliqDM(
    who.email,
    `*${ms.projects.title}* — milestone assigned to you: "${ms.name}"` +
      (ms.due_date ? `\nDue ${ms.due_date}.` : "") +
      (url ? `\n\nMark it complete here when it's done:\n${url}` : "")
  );
  await log("cliq_dm", `Milestone assigned to ${who.name} — ${ms.name}`, ms.projects.id);
}

/** Someone has just been put on a roadblock. */
export async function notifyRoadblockOwner(roadblockId: string, memberId: string) {
  const [{ data: r }, { data: who }] = await Promise.all([
    db.from("roadblocks")
      .select("id, title, detail, target_date, projects ( id, title )")
      .eq("id", roadblockId).single(),
    db.from("team_members").select("id, name, email").eq("id", memberId).single(),
  ]);

  const rb = r as any;
  if (!rb || !who?.email) return;

  const url = await ensureShareUrl(rb.projects.id, memberId);

  await cliqDM(
    who.email,
    `*${rb.projects.title}* — roadblock assigned to you: "${rb.title}"` +
      (rb.detail ? `\n${rb.detail}` : "") +
      (rb.target_date ? `\nTarget ${rb.target_date}.` : "") +
      (url ? `\n\nUpdate it here:\n${url}` : "")
  );
  await log("cliq_dm", `Roadblock assigned to ${who.name} — ${rb.title}`, rb.projects.id);
}

/**
 * A roadblock has been resolved. This gets its own immediate message rather
 * than waiting for the next digest — people are usually waiting on it, and
 * the news is only useful while it's still news.
 */
export async function notifyRoadblockResolved(roadblockId: string) {
  const { data: r } = await db
    .from("roadblocks")
    .select(`
      id, title, projects ( id, title ),
      roadblock_owners ( team_members ( name, email ) )
    `)
    .eq("id", roadblockId).single();

  const rb = r as any;
  if (!rb) return;

  const text =
    `*${rb.projects.title}* — roadblock resolved: "${rb.title}"\n` +
    `Reminders for it stop here.`;

  // The channel first, so whoever was waiting sees it without being DM'd.
  const channel = process.env.OWNER_CLIQ_CHANNEL;
  if (channel) {
    try { await cliqChannel(channel, text); } catch { /* fall through to DMs */ }
  }

  for (const o of rb.roadblock_owners ?? []) {
    const email = o.team_members?.email;
    if (!email) continue;
    try { await cliqDM(email, text); } catch { /* one failure shouldn't stop the rest */ }
  }

  await log("roadblock", `Resolved: ${rb.title}`, rb.projects?.id);
}

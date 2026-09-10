import { db, log } from "./supabase";
import { cliqDM } from "./zoho";
import { ensureShareUrl } from "./ensure-link";

/**
 * One message per person, per project.
 *
 * Assigning someone twelve things used to send twelve direct messages, which
 * is a good way to get your notifications muted. Callers collect everything
 * here and flush once; each person gets a single message listing their items,
 * grouped by kind, with the one share link that covers them all.
 *
 * Grouping is per project on purpose — the share link is per project, so a
 * single message spanning several would need several links and lose the
 * thread of which item belongs where.
 */

type Kind = "milestone" | "task";

interface Item {
  kind: Kind;
  name: string;
  due?: string | null;
}

export class DigestBatch {
  /** projectId → memberId → items */
  private byProject = new Map<string, Map<string, Item[]>>();

  add(projectId: string, memberId: string, item: Item) {
    const people = this.byProject.get(projectId) ?? new Map<string, Item[]>();
    people.set(memberId, [...(people.get(memberId) ?? []), item]);
    this.byProject.set(projectId, people);
  }

  get size() {
    let n = 0;
    for (const people of this.byProject.values()) n += people.size;
    return n;
  }

  /** Send everything collected. Returns how many messages went out. */
  async flush(headline = "assigned to you"): Promise<number> {
    let sent = 0;

    for (const [projectId, people] of this.byProject) {
      const { data: project } = await db
        .from("projects").select("title").eq("id", projectId).single();
      if (!project) continue;

      const memberIds = [...people.keys()];
      const { data: members } = await db
        .from("team_members").select("id, name, email").in("id", memberIds);

      const byId = new Map((members ?? []).map((m: any) => [m.id, m]));

      for (const [memberId, items] of people) {
        const who = byId.get(memberId);
        if (!who?.email) continue;

        const url = await ensureShareUrl(projectId, memberId);
        const text = buildMessage(project.title, items, url, headline);

        try {
          await cliqDM(who.email, text);
          sent++;
        } catch (e: any) {
          await log("cliq_error", `Digest DM to ${who.email} failed: ${e.message}`, projectId);
        }
      }

      await log(
        "cliq_dm",
        `Sent ${people.size} combined message(s) for "${project.title}"`,
        projectId
      );
    }

    this.byProject.clear();
    return sent;
  }
}

function buildMessage(
  projectTitle: string,
  items: Item[],
  url: string | null,
  headline: string
): string {
  const milestones = items.filter((i) => i.kind === "milestone");
  const tasks = items.filter((i) => i.kind === "task");

  // One item reads better as a sentence than as a list of one.
  if (items.length === 1) {
    const i = items[0];
    const label = i.kind === "milestone" ? "milestone" : "action item";
    return (
      `*${projectTitle}* — ${label} ${headline}: "${i.name}"` +
      (i.due ? `\nDue ${i.due}.` : "") +
      (url ? `\n\n${i.kind === "milestone" ? "Mark it complete" : "Close it"} here:\n${url}` : "")
    );
  }

  const line = (i: Item) => `• ${i.name}${i.due ? ` — due ${i.due}` : ""}`;

  const parts = [`*${projectTitle}* — ${items.length} items ${headline}`];

  if (milestones.length) {
    parts.push(
      `\n*Milestones*\n` + milestones.map(line).join("\n")
    );
  }
  if (tasks.length) {
    parts.push(
      `\n*Action items*\n` + tasks.map(line).join("\n")
    );
  }
  if (url) parts.push(`\nUpdate them here:\n${url}`);

  return parts.join("\n");
}

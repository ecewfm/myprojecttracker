import { db, log } from "./supabase";
import { DigestBatch } from "./digest-batch";
import { getProject, nextRef } from "./data";
import { parseWorkbook, toDate, toBool, splitEmails, type Parsed, type ParsedRow } from "./workbook";
import type { ProjectStatus } from "./types";

/**
 * Import is merge-only: a row with an ID updates, a row without creates, and
 * anything absent from the file is left alone. Removing something takes an
 * explicit DELETE in the Action column — an accidental deletion in Excel
 * can't wipe a project.
 */

export interface Change {
  kind: "milestone" | "task" | "roadblock" | "project" | "person";
  action: "create" | "update" | "delete" | "skip";
  label: string;
  detail?: string;
}

export interface Preview {
  projectId: string | null;
  projectTitle: string;
  creatingProject: boolean;
  changes: Change[];
  newPeople: string[];       // emails not currently on the team
  warnings: string[];
  /** Emails that would be newly assigned to something — drives the notify prompt. */
  newlyAssigned: { email: string; item: string }[];
  counts: Record<string, number>;
}

const isDelete = (r: ParsedRow) => /^delete$/i.test(r["Action"] ?? "");

/**
 * The parent of a sub-milestone. Older exports used "Parent ID"; current ones
 * write the parent's name under "Parent". Either is accepted, and the value
 * may be a name or an id — whichever the person typed.
 */
const parentRef = (r: ParsedRow) =>
  (r["Parent"] ?? r["Parent ID"] ?? "").trim();

/**
 * Copying a row in Excel brings its ID along, so several rows end up claiming
 * to be the same record. Left alone, each one overwrites the last and only the
 * final row survives — the rest of the work silently disappears. Catch it here
 * and refuse the import instead.
 */
function duplicateIds(rows: ParsedRow[], nameKey: string) {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const id = (r["ID"] ?? "").trim();
    if (!id) continue;                       // blank means "create", always fine
    const list = seen.get(id) ?? [];
    list.push(r[nameKey] || "(unnamed)");
    seen.set(id, list);
  }
  return [...seen.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([id, names]) => ({ id, names }));
}

function reportDuplicates(
  warnings: string[],
  rows: ParsedRow[],
  nameKey: string,
  sheet: string
) {
  for (const { id, names } of duplicateIds(rows, nameKey)) {
    const shown = names.slice(0, 4).join(", ");
    const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
    warnings.push(
      `${sheet}: ${names.length} rows share the ID ${id.slice(0, 8)}… (${shown}${more}). ` +
      `That usually means a row was copied and the ID came with it. ` +
      `Clear the ID on the rows that should be new, then import again.`
    );
  }
}

async function teamByEmail() {
  const { data } = await db.from("team_members").select("id, name, email");
  const map = new Map<string, { id: string; name: string; email: string }>();
  for (const m of data ?? []) map.set(m.email.toLowerCase(), m as any);
  return map;
}

/** A readable name from an email, for people created on the fly. */
function nameFromEmail(email: string) {
  const local = email.split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || email;
}

/* ══════════════════ preview ══════════════════ */

export async function previewImport(buf: ArrayBuffer): Promise<Preview> {
  const parsed = parseWorkbook(buf);
  const team = await teamByEmail();

  const projectId = parsed.project["Project ID"] || null;
  const title = parsed.project["Title"] || "";

  const changes: Change[] = [];
  const warnings: string[] = [];
  const newPeople = new Set<string>();
  const newlyAssigned: { email: string; item: string }[] = [];

  if (!title && !projectId) {
    warnings.push("The Project sheet has no Title and no Project ID — nothing to import into.");
  }

  // Duplicate IDs are a hard stop — importing would destroy rows.
  reportDuplicates(warnings, parsed.milestones, "Milestone", "Milestones");
  reportDuplicates(warnings, parsed.tasks, "Action item", "Action items");
  reportDuplicates(warnings, parsed.roadblocks, "Roadblock", "Roadblocks");

  const existing = projectId ? await getProject(projectId) : null;
  if (projectId && !existing) {
    warnings.push(`Project ID ${projectId} wasn't found. Clear it to create a new project instead.`);
  }

  const creatingProject = !existing;
  if (creatingProject && title) {
    changes.push({ kind: "project", action: "create", label: title });
  } else if (existing) {
    if (title && title !== existing.title) {
      changes.push({ kind: "project", action: "update", label: `Renamed to "${title}"` });
    }
  }

  // Who is currently assigned to what, so we only flag genuinely new assignments.
  const currentAssignees = new Map<string, Set<string>>();
  if (existing) {
    const walk = (list: any[]) => {
      for (const m of list) {
        currentAssignees.set(m.id, new Set((m.assignees ?? []).map((a: any) => a.email.toLowerCase())));
        walk(m.children ?? []);
      }
    };
    walk(existing.milestones);
    for (const t of existing.tasks) {
      currentAssignees.set(t.id, new Set((t.assignees ?? []).map((a: any) => a.email.toLowerCase())));
    }
  }

  const noteEmails = (raw: string, itemId: string, itemLabel: string) => {
    for (const e of splitEmails(raw)) {
      if (!team.has(e)) newPeople.add(e);
      const already = currentAssignees.get(itemId);
      if (!already || !already.has(e)) newlyAssigned.push({ email: e, item: itemLabel });
    }
  };

  // ── milestones ──
  for (const r of parsed.milestones) {
    const id = r["ID"];
    const name = r["Milestone"];
    if (!name && !id) continue;

    if (isDelete(r)) {
      if (id) changes.push({ kind: "milestone", action: "delete", label: name || id });
      continue;
    }
    if (!name) {
      warnings.push(`A milestone row has no name and was skipped${id ? ` (ID ${id})` : ""}.`);
      continue;
    }

    noteEmails(r["Assigned emails"], id, name);
    changes.push({
      kind: "milestone",
      action: id ? "update" : "create",
      label: name,
      detail: parentRef(r) ? "sub-milestone" : undefined,
    });
  }

  // ── action items ──
  for (const r of parsed.tasks) {
    const id = r["ID"];
    const name = r["Action item"];
    if (!name && !id) continue;

    if (isDelete(r)) {
      if (id) changes.push({ kind: "task", action: "delete", label: name || id });
      continue;
    }
    if (!name) {
      warnings.push(`An action item row has no name and was skipped${id ? ` (ID ${id})` : ""}.`);
      continue;
    }

    noteEmails(r["Assigned emails"], id, name);
    changes.push({ kind: "task", action: id ? "update" : "create", label: name });
  }

  // ── roadblocks ──
  for (const r of parsed.roadblocks) {
    const id = r["ID"];
    const title2 = r["Roadblock"];
    if (!title2 && !id) continue;

    if (isDelete(r)) {
      if (id) changes.push({ kind: "roadblock", action: "delete", label: title2 || id });
      continue;
    }
    if (!title2) {
      warnings.push(`A roadblock row has no title and was skipped${id ? ` (ID ${id})` : ""}.`);
      continue;
    }

    const owner = splitEmails(r["Owner email"])[0];
    if (owner && !team.has(owner)) newPeople.add(owner);

    changes.push({ kind: "roadblock", action: id ? "update" : "create", label: title2 });
  }

  // Project-level people
  for (const e of splitEmails(parsed.project["Team emails"])) {
    if (!team.has(e)) newPeople.add(e);
  }
  const ownerEmail = splitEmails(parsed.project["Owner email"])[0];
  if (ownerEmail && !team.has(ownerEmail)) newPeople.add(ownerEmail);

  const counts: Record<string, number> = {};
  for (const c of changes) {
    const key = `${c.action}_${c.kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return {
    projectId: existing?.id ?? null,
    projectTitle: title || existing?.title || "Untitled",
    creatingProject,
    changes,
    newPeople: [...newPeople],
    warnings,
    newlyAssigned,
    counts,
  };
}

/* ══════════════════ apply ══════════════════ */

export interface ApplyResult {
  projectId: string;
  created: number;
  updated: number;
  deleted: number;
  peopleAdded: string[];
  notified: number;
  problems: string[];
}

export async function applyImport(
  buf: ArrayBuffer,
  opts: { notify: boolean }
): Promise<ApplyResult> {
  const parsed = parseWorkbook(buf);
  const team = await teamByEmail();

  // Never write a file that would collapse several rows into one. The preview
  // warns about this, but the apply endpoint is what actually protects the data.
  const dupes = [
    ...duplicateIds(parsed.milestones, "Milestone").map((d) => ({ ...d, sheet: "Milestones" })),
    ...duplicateIds(parsed.tasks, "Action item").map((d) => ({ ...d, sheet: "Action items" })),
    ...duplicateIds(parsed.roadblocks, "Roadblock").map((d) => ({ ...d, sheet: "Roadblocks" })),
  ];
  if (dupes.length) {
    const first = dupes[0];
    throw new Error(
      `Import stopped — nothing was changed. ${first.sheet} has ${first.names.length} rows ` +
      `sharing one ID, so they'd overwrite each other and only the last would survive. ` +
      `Clear the ID column on the rows that should be new, then import again.`
    );
  }

  const result: ApplyResult = {
    projectId: "", created: 0, updated: 0, deleted: 0,
    peopleAdded: [], notified: 0, problems: [],
  };

  // Collect everyone's new assignments and send one message each at the end,
  // rather than a message per item.
  const batch = new DigestBatch();

  /** Resolve an email to a member id, creating the person if they're new. */
  async function memberId(email: string): Promise<string | null> {
    const key = email.toLowerCase();
    const hit = team.get(key);
    if (hit) return hit.id;

    const { data, error } = await db.from("team_members")
      .insert({ name: nameFromEmail(key), email: key })
      .select("id, name, email").single();

    if (error || !data) {
      result.problems.push(`Couldn't add ${email}: ${error?.message ?? "unknown"}`);
      return null;
    }
    team.set(key, data as any);
    result.peopleAdded.push(key);
    return data.id;
  }

  async function idsFor(raw: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of splitEmails(raw)) {
      const id = await memberId(e);
      if (id) out.push(id);
    }
    return out;
  }

  // ── the project itself ──
  const givenId = parsed.project["Project ID"] || null;
  const title = parsed.project["Title"] || "Untitled project";
  const existing = givenId ? await getProject(givenId) : null;

  const ownerEmail = splitEmails(parsed.project["Owner email"])[0];
  const ownerId = ownerEmail ? await memberId(ownerEmail) : null;

  const statusRaw = (parsed.project["Status"] || "todo").toLowerCase();
  const validStatus: ProjectStatus[] = ["todo","pending","dev","testing","done","impl","scrap"];
  const status = (validStatus.includes(statusRaw as ProjectStatus)
    ? statusRaw : "todo") as ProjectStatus;

  let projectId: string;

  if (existing) {
    projectId = existing.id;
    const patch: Record<string, unknown> = {};
    if (title && title !== existing.title) patch.title = title;
    if (ownerId) patch.owner_id = ownerId;
    if (parsed.project["Target date"] !== undefined) {
      patch.due_date = toDate(parsed.project["Target date"]);
    }
    if (parsed.project["Priority"]) patch.priority = toBool(parsed.project["Priority"]);
    if (statusRaw) patch.status = status;

    if (Object.keys(patch).length) {
      await db.from("projects").update(patch).eq("id", projectId);
      result.updated++;
    }
  } else {
    const { data, error } = await db.from("projects").insert({
      ref: await nextRef(),
      title,
      status,
      owner_id: ownerId,
      due_date: toDate(parsed.project["Target date"]),
      priority: toBool(parsed.project["Priority"]),
    }).select("id").single();

    if (error || !data) throw new Error(`Couldn't create the project: ${error?.message}`);
    projectId = data.id;
    result.created++;
  }
  result.projectId = projectId;

  // Project team
  for (const e of splitEmails(parsed.project["Team emails"])) {
    const id = await memberId(e);
    if (id) {
      await db.from("project_members")
        .upsert({ project_id: projectId, member_id: id }, { onConflict: "project_id,member_id" });
    }
  }

  // ── milestones ──
  //
  // Batched. Row-by-row this was four or five round trips each, so a 45-row
  // sheet meant ~300 sequential queries and the function timed out before
  // finishing. Now it's a handful of queries whatever the file size.
  const idMap = new Map<string, string>();
  const nameToId = new Map<string, string>();

  /**
   * What's already on the project, keyed by name and parent.
   *
   * A row with a blank ID used to insert unconditionally, so importing the
   * same file twice — or retrying after a failure — created a second copy of
   * every row. Matching on name makes a re-import update instead, which is
   * what "merge" should mean.
   */
  const existingKey = new Map<string, string>();   // "parent|name" → milestone id

  const keyOf = (name: string, parentId: string | null) =>
    `${parentId ?? "root"}|${name.trim().toLowerCase()}`;

  {
    const { data: current } = await db.from("milestones")
      .select("id, name, parent_id").eq("project_id", projectId);
    for (const m of current ?? []) {
      existingKey.set(keyOf(String(m.name), m.parent_id), m.id);
      if (!m.parent_id) nameToId.set(String(m.name).trim().toLowerCase(), m.id);
    }
  }

  const msRows = parsed.milestones.filter((r) => r["Milestone"] || r["ID"]);

  const msDel = msRows.filter((r) => isDelete(r) && r["ID"]).map((r) => r["ID"]);
  if (msDel.length) {
    await db.from("milestones").delete().in("id", msDel).eq("project_id", projectId);
    result.deleted += msDel.length;
  }

  const liveMs = msRows.filter((r) => !isDelete(r) && r["Milestone"]);

  // Resolve every email once, up front, so the write loops never wait on it.
  {
    const emails = new Set<string>();
    for (const r of liveMs) splitEmails(r["Assigned emails"]).forEach((e) => emails.add(e));
    for (const r of parsed.tasks) splitEmails(r["Assigned emails"]).forEach((e) => emails.add(e));
    for (const r of parsed.roadblocks) splitEmails(r["Owner email"]).forEach((e) => emails.add(e));
    for (const e of emails) await memberId(e);
  }

  let position = 1000;

  async function writeLevel(rows: ParsedRow[], resolveParent: boolean) {
    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    for (const r of rows) {
      const name = r["Milestone"];
      let parentId: string | null = null;

      if (resolveParent) {
        const ref = parentRef(r);
        parentId =
          idMap.get(ref) ??
          nameToId.get(ref.toLowerCase()) ??
          (ref.includes("-") ? ref : null);
        if (!parentId) {
          result.problems.push(
            `Sub-milestone "${name}": no parent called "${ref}" — created at the top level.`
          );
        }
      }

      const fields = {
        name,
        done: toBool(r["Done"]),
        due_date: toDate(r["Due date"]),
        note: r["Notes"] ?? "",
        parent_id: parentId,
        project_id: projectId,
      };

      // An explicit ID wins. Otherwise, if something with this name already
      // sits under the same parent, update that rather than making a twin.
      const existingId = r["ID"] || existingKey.get(keyOf(name, parentId));

      if (existingId) {
        toUpdate.push({ id: existingId, ...fields });
      } else {
        position++;
        toInsert.push({ ...fields, position });
      }
    }

    if (toUpdate.length) {
      const { error } = await db.from("milestones").upsert(toUpdate);
      if (error) result.problems.push(`Milestones: ${error.message}`);
      else result.updated += toUpdate.length;
      for (const u of toUpdate) {
        idMap.set(u.id, u.id);
        existingKey.set(keyOf(String(u.name), u.parent_id), u.id);
        if (!u.parent_id) nameToId.set(String(u.name).trim().toLowerCase(), u.id);
      }
    }

    if (toInsert.length) {
      const { data, error } = await db.from("milestones")
        .insert(toInsert).select("id, name, parent_id");
      if (error) result.problems.push(`Milestones: ${error.message}`);
      else {
        result.created += data?.length ?? 0;
        for (const row of data ?? []) {
          existingKey.set(keyOf(String(row.name), row.parent_id), row.id);
          if (!row.parent_id) nameToId.set(String(row.name).trim().toLowerCase(), row.id);
        }
      }
    }
  }

  await writeLevel(liveMs.filter((r) => !parentRef(r)), false);
  await writeLevel(liveMs.filter((r) => parentRef(r)), true);

  // Assignees for every touched milestone, in three queries rather than 3n.
  {
    // Match on parent AND name. Keying on name alone collided whenever two
    // sub-milestones shared a name under different parents — "Receiving
    // leader named" exists under several transitions — so one row took the
    // assignees and the others were left blank.
    const { data: allMs } = await db.from("milestones")
      .select("id, name, parent_id").eq("project_id", projectId);

    const byKey = new Map<string, string>();
    for (const m of allMs ?? []) byKey.set(keyOf(String(m.name), m.parent_id), m.id);

    const targets: { id: string; emails: string[] }[] = [];
    for (const r of liveMs) {
      let id: string | undefined = r["ID"] || undefined;

      if (!id) {
        // Resolve the row's parent the same way the write pass did, so the
        // key matches the milestone that was actually created.
        const ref = parentRef(r);
        const parentId = ref
          ? idMap.get(ref) ?? nameToId.get(ref.toLowerCase()) ?? (ref.includes("-") ? ref : null)
          : null;
        id = byKey.get(keyOf(String(r["Milestone"]), parentId));
      }

      if (id) targets.push({ id, emails: splitEmails(r["Assigned emails"]) });
      else {
        result.problems.push(
          `Couldn't match "${r["Milestone"]}" back to a milestone — its assignees weren't set.`
        );
      }
    }

    const touched = targets.map((t) => t.id);
    if (touched.length) {
      const { data: before } = await db.from("milestone_assignees")
        .select("milestone_id, member_id").in("milestone_id", touched);

      const had = new Map<string, Set<string>>();
      for (const bRow of before ?? []) {
        const set = had.get(bRow.milestone_id) ?? new Set<string>();
        set.add(bRow.member_id); had.set(bRow.milestone_id, set);
      }

      await db.from("milestone_assignees").delete().in("milestone_id", touched);

      const inserts: { milestone_id: string; member_id: string }[] = [];
      const fresh: { itemId: string; memberId: string }[] = [];

      for (const t of targets) {
        for (const email of t.emails) {
          const mid = await memberId(email);
          if (!mid) continue;
          inserts.push({ milestone_id: t.id, member_id: mid });
          if (!had.get(t.id)?.has(mid)) fresh.push({ itemId: t.id, memberId: mid });
        }
      }

      if (inserts.length) await db.from("milestone_assignees").insert(inserts);

      if (opts.notify && fresh.length) {
        const byId = new Map(
          (allMs ?? []).map((m: any) => [m.id, m])
        );
        for (const f of fresh) {
          const m = byId.get(f.itemId) as any;
          batch.add(projectId, f.memberId, {
            kind: "milestone",
            name: m?.name ?? "a milestone",
            due: m?.due_date ?? null,
          });
        }
      }
    }
  }

  // ── action items, batched ──
  {
    const tRows = parsed.tasks.filter((r) => r["Action item"] || r["ID"]);

    const del = tRows.filter((r) => isDelete(r) && r["ID"]).map((r) => r["ID"]);
    if (del.length) {
      await db.from("tasks").delete().in("id", del).eq("project_id", projectId);
      result.deleted += del.length;
    }

    const liveT = tRows.filter((r) => !isDelete(r) && r["Action item"]);

    // Same de-duplication as milestones: a blank ID matches an existing
    // action item by name rather than creating a second one.
    const existingT = new Map<string, string>();
    {
      const { data: current } = await db.from("tasks")
        .select("id, name").eq("project_id", projectId);
      for (const t of current ?? []) existingT.set(String(t.name).trim().toLowerCase(), t.id);
    }

    const toUpdate: any[] = [];
    const toInsert: any[] = [];

    for (const r of liveT) {
      const fields = {
        name: r["Action item"],
        done: toBool(r["Done"]),
        due_date: toDate(r["Due date"]),
        note: r["Notes"] ?? "",
        project_id: projectId,
      };
      const existingId = r["ID"] || existingT.get(String(r["Action item"]).trim().toLowerCase());
      if (existingId) toUpdate.push({ id: existingId, ...fields });
      else toInsert.push(fields);
    }

    if (toUpdate.length) {
      const { error } = await db.from("tasks").upsert(toUpdate);
      if (error) result.problems.push(`Action items: ${error.message}`);
      else result.updated += toUpdate.length;
    }
    if (toInsert.length) {
      const { data, error } = await db.from("tasks").insert(toInsert).select("id");
      if (error) result.problems.push(`Action items: ${error.message}`);
      else result.created += data?.length ?? 0;
    }

    const { data: allT } = await db.from("tasks").select("id, name").eq("project_id", projectId);
    const byName = new Map<string, string>();
    for (const t of allT ?? []) byName.set(String(t.name).trim().toLowerCase(), t.id);

    const targets: { id: string; emails: string[] }[] = [];
    for (const r of liveT) {
      const id = r["ID"] || byName.get(String(r["Action item"]).trim().toLowerCase());
      if (id) targets.push({ id, emails: splitEmails(r["Assigned emails"]) });
    }

    const touched = targets.map((t) => t.id);
    if (touched.length) {
      const { data: before } = await db.from("task_assignees")
        .select("task_id, member_id").in("task_id", touched);

      const had = new Map<string, Set<string>>();
      for (const bRow of before ?? []) {
        const set = had.get(bRow.task_id) ?? new Set<string>();
        set.add(bRow.member_id); had.set(bRow.task_id, set);
      }

      await db.from("task_assignees").delete().in("task_id", touched);

      const inserts: { task_id: string; member_id: string }[] = [];
      const fresh: { itemId: string; memberId: string }[] = [];

      for (const t of targets) {
        for (const email of t.emails) {
          const mid = await memberId(email);
          if (!mid) continue;
          inserts.push({ task_id: t.id, member_id: mid });
          if (!had.get(t.id)?.has(mid)) fresh.push({ itemId: t.id, memberId: mid });
        }
      }

      if (inserts.length) await db.from("task_assignees").insert(inserts);

      if (opts.notify && fresh.length) {
        const byId = new Map((allT ?? []).map((t: any) => [t.id, t]));
        for (const f of fresh) {
          const t = byId.get(f.itemId) as any;
          batch.add(projectId, f.memberId, {
            kind: "task",
            name: t?.name ?? "an action item",
            due: t?.due_date ?? null,
          });
        }
      }
    }
  }

  // ── roadblocks, batched ──
  {
    const rRows = parsed.roadblocks.filter((r) => r["Roadblock"] || r["ID"]);

    const del = rRows.filter((r) => isDelete(r) && r["ID"]).map((r) => r["ID"]);
    if (del.length) {
      await db.from("roadblocks").delete().in("id", del).eq("project_id", projectId);
      result.deleted += del.length;
    }

    const liveR = rRows.filter((r) => !isDelete(r) && r["Roadblock"]);

    const existingR = new Map<string, string>();
    {
      const { data: current } = await db.from("roadblocks")
        .select("id, title").eq("project_id", projectId);
      for (const rb of current ?? []) existingR.set(String(rb.title).trim().toLowerCase(), rb.id);
    }

    const valid = ["open", "progress", "escalated", "resolved"];
    const toUpdate: any[] = [];
    const toInsert: any[] = [];

    for (const r of liveR) {
      const ownerE = splitEmails(r["Owner email"])[0];
      const st = (r["Status"] || "open").toLowerCase();
      const fields = {
        title: r["Roadblock"],
        detail: r["Detail"] ?? "",
        status: valid.includes(st) ? st : "open",
        owner_id: ownerE ? await memberId(ownerE) : null,
        target_date: toDate(r["Target date"]),
        project_id: projectId,
      };
      const existingId = r["ID"] || existingR.get(String(r["Roadblock"]).trim().toLowerCase());
      if (existingId) toUpdate.push({ id: existingId, ...fields });
      else toInsert.push(fields);
    }

    if (toUpdate.length) {
      const { error } = await db.from("roadblocks").upsert(toUpdate);
      if (error) result.problems.push(`Roadblocks: ${error.message}`);
      else result.updated += toUpdate.length;
    }
    if (toInsert.length) {
      const { error } = await db.from("roadblocks").insert(toInsert);
      if (error) result.problems.push(`Roadblocks: ${error.message}`);
      else result.created += toInsert.length;
    }
  }

  // Renumber so imported rows sit in sheet order — one upsert, not one
  // update per milestone.
  {
    const { data: ordered } = await db.from("milestones")
      .select("id, position, parent_id").eq("project_id", projectId).order("position");

    let n = 0, sub = 0;
    const renumbered = (ordered ?? [])
      .map((m: any) => ({ id: m.id, position: m.parent_id ? ++sub : ++n, prev: m.position }))
      .filter((m) => m.position !== m.prev)
      .map(({ id, position }) => ({ id, position }));

    if (renumbered.length) await db.from("milestones").upsert(renumbered);
  }

  // One message per person now that every row is written.
  if (opts.notify) {
    result.notified = await batch.flush("assigned to you");
  }

  await log(
    "import",
    `Import into "${title}" — ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
    projectId
  );

  return result;
}

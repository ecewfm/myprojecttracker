import { db, log } from "./supabase";
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
      detail: r["Parent ID"] ? "sub-milestone" : undefined,
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

  const result: ApplyResult = {
    projectId: "", created: 0, updated: 0, deleted: 0,
    peopleAdded: [], notified: 0, problems: [],
  };

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

  // ── milestones: parents first so children can reference them ──
  const idMap = new Map<string, string>();     // sheet ID → real ID
  const rows = parsed.milestones.filter((r) => r["Milestone"] || r["ID"]);
  const parents = rows.filter((r) => !r["Parent ID"]);
  const children = rows.filter((r) => r["Parent ID"]);
  let position = 0;

  for (const pass of [parents, children]) {
    for (const r of pass) {
      const sheetId = r["ID"];
      const name = r["Milestone"];

      if (isDelete(r)) {
        if (sheetId) {
          await db.from("milestones").delete().eq("id", sheetId).eq("project_id", projectId);
          result.deleted++;
        }
        continue;
      }
      if (!name) continue;

      const parentSheetId = r["Parent ID"];
      const parentId = parentSheetId
        ? idMap.get(parentSheetId) ?? parentSheetId
        : null;

      const fields: Record<string, unknown> = {
        name,
        done: toBool(r["Done"]),
        due_date: toDate(r["Due date"]),
        note: r["Notes"] ?? "",
        parent_id: parentId,
      };

      let realId = sheetId;

      if (sheetId) {
        const { error } = await db.from("milestones")
          .update(fields).eq("id", sheetId).eq("project_id", projectId);
        if (error) { result.problems.push(`Milestone "${name}": ${error.message}`); continue; }
        result.updated++;
      } else {
        position++;
        const { data, error } = await db.from("milestones")
          .insert({ ...fields, project_id: projectId, position: position + 1000 })
          .select("id").single();
        if (error || !data) { result.problems.push(`Milestone "${name}": ${error?.message}`); continue; }
        realId = data.id;
        result.created++;
      }

      if (sheetId) idMap.set(sheetId, realId!);

      // assignees
      const ids = await idsFor(r["Assigned emails"]);
      const { data: before } = await db.from("milestone_assignees")
        .select("member_id").eq("milestone_id", realId!);
      const had = new Set((before ?? []).map((b: any) => b.member_id));

      await db.from("milestone_assignees").delete().eq("milestone_id", realId!);
      if (ids.length) {
        await db.from("milestone_assignees").insert(
          ids.map((member_id) => ({ milestone_id: realId!, member_id }))
        );
      }

      if (opts.notify) {
        const { notifyMilestoneAssignment } = await import("./reminders");
        for (const id of ids) {
          if (!had.has(id)) {
            notifyMilestoneAssignment(realId!, id).catch(() => {});
            result.notified++;
          }
        }
      }
    }
  }

  // ── action items ──
  for (const r of parsed.tasks) {
    const sheetId = r["ID"];
    const name = r["Action item"];

    if (isDelete(r)) {
      if (sheetId) {
        await db.from("tasks").delete().eq("id", sheetId).eq("project_id", projectId);
        result.deleted++;
      }
      continue;
    }
    if (!name) continue;

    const fields: Record<string, unknown> = {
      name,
      done: toBool(r["Done"]),
      due_date: toDate(r["Due date"]),
      note: r["Notes"] ?? "",
    };

    let realId = sheetId;

    if (sheetId) {
      const { error } = await db.from("tasks")
        .update(fields).eq("id", sheetId).eq("project_id", projectId);
      if (error) { result.problems.push(`Action item "${name}": ${error.message}`); continue; }
      result.updated++;
    } else {
      const { data, error } = await db.from("tasks")
        .insert({ ...fields, project_id: projectId }).select("id").single();
      if (error || !data) { result.problems.push(`Action item "${name}": ${error?.message}`); continue; }
      realId = data.id;
      result.created++;
    }

    const ids = await idsFor(r["Assigned emails"]);
    const { data: before } = await db.from("task_assignees")
      .select("member_id").eq("task_id", realId!);
    const had = new Set((before ?? []).map((b: any) => b.member_id));

    await db.from("task_assignees").delete().eq("task_id", realId!);
    if (ids.length) {
      await db.from("task_assignees").insert(
        ids.map((member_id) => ({ task_id: realId!, member_id }))
      );
    }

    if (opts.notify) {
      const { notifyAssignment } = await import("./reminders");
      for (const id of ids) {
        if (!had.has(id)) {
          notifyAssignment(realId!, id).catch(() => {});
          result.notified++;
        }
      }
    }
  }

  // ── roadblocks ──
  for (const r of parsed.roadblocks) {
    const sheetId = r["ID"];
    const title2 = r["Roadblock"];

    if (isDelete(r)) {
      if (sheetId) {
        await db.from("roadblocks").delete().eq("id", sheetId).eq("project_id", projectId);
        result.deleted++;
      }
      continue;
    }
    if (!title2) continue;

    const ownerE = splitEmails(r["Owner email"])[0];
    const oid = ownerE ? await memberId(ownerE) : null;
    const st = (r["Status"] || "open").toLowerCase();
    const validRb = ["open", "progress", "escalated", "resolved"];

    const fields: Record<string, unknown> = {
      title: title2,
      detail: r["Detail"] ?? "",
      status: validRb.includes(st) ? st : "open",
      owner_id: oid,
      target_date: toDate(r["Target date"]),
    };

    if (sheetId) {
      const { error } = await db.from("roadblocks")
        .update(fields).eq("id", sheetId).eq("project_id", projectId);
      if (error) result.problems.push(`Roadblock "${title2}": ${error.message}`);
      else result.updated++;
    } else {
      const { error } = await db.from("roadblocks")
        .insert({ ...fields, project_id: projectId });
      if (error) result.problems.push(`Roadblock "${title2}": ${error.message}`);
      else result.created++;
    }
  }

  // Renumber milestones so imported rows sit in sheet order.
  const { data: allMs } = await db.from("milestones")
    .select("id, position, parent_id").eq("project_id", projectId).order("position");
  let n = 0, sub = 0;
  for (const m of allMs ?? []) {
    const next = m.parent_id ? ++sub : ++n;
    if (m.position !== next) {
      await db.from("milestones").update({ position: next }).eq("id", m.id);
    }
  }

  await log(
    "import",
    `Import into "${title}" — ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
    projectId
  );

  return result;
}

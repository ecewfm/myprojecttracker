import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { getProject, nextRef } from "@/lib/data";
import { isSignedIn } from "@/lib/auth";

/**
 * Duplicate a project: structure in, history out.
 *
 * Copied — milestones and sub-milestones (with their assignees, due dates
 * and order), action items, the People list, phase, labels, and settings.
 * Reset  — everything is marked not-done, and progress starts at zero.
 * Dropped — roadblocks, notes, AI analysis, share links, and the submission
 *           trail. Those belong to the run that produced them, not the copy.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const src = await getProject(params.id);
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: project, error } = await db.from("projects").insert({
    ref: await nextRef(),
    title: `${src.title} (copy)`,
    status: "todo",
    phase: src.phase,
    owner_id: src.owner?.id ?? null,
    due_date: null,              // a copy needs its own date
    priority: src.priority,
    shared: src.shared,
    labels: src.labels,
    reminders_on: src.reminders_on,
    cliq_channel: src.cliq_channel,
  }).select("id, ref, title").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // People
  if (src.members.length) {
    await db.from("project_members").insert(
      src.members.map((m) => ({ project_id: project.id, member_id: m.id }))
    );
  }

  // Top-level milestones first, so children can point at the new parents.
  const parentMap = new Map<string, string>();

  for (const m of src.milestones) {
    const { data: copy } = await db.from("milestones").insert({
      project_id: project.id,
      position: m.position,
      name: m.name,
      note: "",                       // notes describe the original run
      done: false,
      due_date: m.due_date,
    }).select("id").single();

    if (!copy) continue;
    parentMap.set(m.id, copy.id);

    if (m.assignees?.length) {
      await db.from("milestone_assignees").insert(
        m.assignees.map((a) => ({ milestone_id: copy.id, member_id: a.id }))
      );
    }
  }

  // Sub-milestones, attached to their copied parent.
  const children = src.milestones.flatMap((m) =>
    (m.children ?? []).map((c) => ({ parent: m.id, child: c }))
  );

  for (const { parent, child } of children) {
    if (!parentMap.has(parent)) continue;
    const { data: copy } = await db.from("milestones").insert({
      project_id: project.id,
      parent_id: parentMap.get(parent)!,
      position: child.position,
      name: child.name,
      note: "",
      done: false,
      due_date: child.due_date,
    }).select("id").single();

    if (copy && child.assignees?.length) {
      await db.from("milestone_assignees").insert(
        child.assignees.map((a) => ({ milestone_id: copy.id, member_id: a.id }))
      );
    }
  }

  // Action items, reset and without their old dates.
  for (const t of src.tasks) {
    const { data: copy } = await db.from("tasks").insert({
      project_id: project.id,
      name: t.name,
      due_date: null,
      done: false,
      note: "",
    }).select("id").single();

    if (copy && t.assignees?.length) {
      await db.from("task_assignees").insert(
        t.assignees.map((a) => ({ task_id: copy.id, member_id: a.id }))
      );
    }
  }

  await log("duplicate", `Duplicated "${src.title}" as ${project.ref}`, project.id);
  return NextResponse.json(project, { status: 201 });
}

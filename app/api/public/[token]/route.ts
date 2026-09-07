import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getProject } from "@/lib/data";
import { resolveToken, recordSubmission } from "@/lib/share";
import { STATUS_COLUMNS } from "@/lib/types";

/**
 * Public project view. Authenticated by the share token in the URL —
 * no session. Returns the whole project plus which items belong to the
 * person holding this link, so the page can highlight theirs.
 */
export async function GET(_: Request, { params }: { params: { token: string } }) {
  const ctx = await resolveToken(params.token);
  if (!ctx) return NextResponse.json({ error: "link_inactive" }, { status: 404 });

  const p = await getProject(ctx.projectId);
  if (!p) return NextResponse.json({ error: "link_inactive" }, { status: 404 });

  const me = ctx.member.id;

  return NextResponse.json({
    viewer: ctx.member,
    project: {
      ref: p.ref,
      title: p.title,
      status: STATUS_COLUMNS.find((c) => c.key === p.status)?.label ?? p.status,
      phase: p.phase,
      percent: p.percent,
      due_date: p.due_date,
      owner: p.owner?.name ?? null,
      milestones: p.milestones.flatMap((m) => [
        {
          id: m.id, name: m.name, done: m.done, note: m.note,
          due_date: m.due_date,
          assignee: m.assignee?.name ?? null,
          mine: m.assignee?.id === me,
          depth: 0,
          // so the page can show "2/4" on a parent without extra work
          child_total: m.children?.length ?? 0,
          child_done: m.children?.filter((c) => c.done).length ?? 0,
        },
        // Sub-milestones follow their parent, flattened with a depth flag.
        // The page indents them; keeping the list flat means the existing
        // rendering and the "mine" highlighting work unchanged.
        ...(m.children ?? []).map((c) => ({
          id: c.id, name: c.name, done: c.done, note: c.note,
          due_date: c.due_date,
          assignee: c.assignee?.name ?? null,
          mine: c.assignee?.id === me,
          depth: 1,
          child_total: 0,
          child_done: 0,
        })),
      ]),
      tasks: p.tasks.map((t) => ({
        id: t.id, name: t.name, done: t.done, due_date: t.due_date, note: t.note,
        assignee: t.assignee?.name ?? null,
        mine: t.assignee?.id === me,
      })),
      roadblocks: p.roadblocks.map((r) => ({
        id: r.id, title: r.title, detail: r.detail, status: r.status,
        owner: r.owner?.name ?? null,
        raised_at: r.raised_at,
      })),
    },
  });
}

/**
 * Actions from the public page. Everything is scoped: a person can only
 * close items assigned to them, and can only add — never delete, never
 * edit settings, never reach another project.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await resolveToken(params.token);
  if (!ctx) return NextResponse.json({ error: "link_inactive" }, { status: 404 });

  const body = await req.json();
  const { action } = body;
  const me = ctx.member.id;

  // ── close an action item assigned to them ──
  if (action === "close_task") {
    const { data: task } = await db.from("tasks")
      .select("id, name, assignee_id, project_id")
      .eq("id", body.id).single();

    if (!task || task.project_id !== ctx.projectId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (task.assignee_id !== me) {
      return NextResponse.json({ error: "That item isn't assigned to you." }, { status: 403 });
    }

    await db.from("tasks")
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq("id", task.id);

    await recordSubmission({
      projectId: ctx.projectId, memberId: me, memberName: ctx.member.name,
      kind: "task_closed", subject: task.name, note: body.note,
    });
    return NextResponse.json({ ok: true });
  }

  // ── close a milestone assigned to them ──
  if (action === "close_milestone") {
    const { data: ms } = await db.from("milestones")
      .select("id, name, assignee_id, project_id")
      .eq("id", body.id).single();

    if (!ms || ms.project_id !== ctx.projectId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (ms.assignee_id !== me) {
      return NextResponse.json({ error: "That milestone isn't assigned to you." }, { status: 403 });
    }

    await db.from("milestones")
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq("id", ms.id);

    await recordSubmission({
      projectId: ctx.projectId, memberId: me, memberName: ctx.member.name,
      kind: "milestone_closed", subject: ms.name, note: body.note,
    });
    return NextResponse.json({ ok: true });
  }

  // ── raise a roadblock ──
  if (action === "add_roadblock") {
    const title = (body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "Give it a title." }, { status: 400 });

    await db.from("roadblocks").insert({
      project_id: ctx.projectId,
      title,
      detail: (body.detail ?? "").trim(),
      status: "open",
      owner_id: me,
    });

    await recordSubmission({
      projectId: ctx.projectId, memberId: me, memberName: ctx.member.name,
      kind: "roadblock_added", subject: title, note: body.detail,
    });
    return NextResponse.json({ ok: true });
  }

  // ── leave a note on a milestone, or a general one ──
  if (action === "add_note") {
    const note = (body.note ?? "").trim();
    if (!note) return NextResponse.json({ error: "Write something first." }, { status: 400 });

    let subject = "General note";

    if (body.task_id) {
      const { data: tk } = await db.from("tasks")
        .select("id, name, note, project_id").eq("id", body.task_id).single();
      if (tk && tk.project_id === ctx.projectId) {
        const stamp = `[${ctx.member.name}] ${note}`;
        await db.from("tasks")
          .update({ note: tk.note ? `${tk.note}\n${stamp}` : stamp })
          .eq("id", tk.id);
        subject = tk.name;
      }
    } else if (body.milestone_id) {
      const { data: ms } = await db.from("milestones")
        .select("id, name, note, project_id").eq("id", body.milestone_id).single();
      if (ms && ms.project_id === ctx.projectId) {
        const stamp = `[${ctx.member.name}] ${note}`;
        await db.from("milestones")
          .update({ note: ms.note ? `${ms.note}\n${stamp}` : stamp })
          .eq("id", ms.id);
        subject = ms.name;
      }
    }

    await recordSubmission({
      projectId: ctx.projectId, memberId: me, memberName: ctx.member.name,
      kind: "note_added", subject, note,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

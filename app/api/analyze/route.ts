import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { getProject } from "@/lib/data";
import { analyseProject } from "@/lib/gemini";
import { isSignedIn } from "@/lib/auth";

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { project_id } = await req.json();

  const p = await getProject(project_id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: settings } = await db
    .from("settings").select("analysis_prompt").eq("id", 1).single();

  try {
    const summary = await analyseProject({
      title: p.title,
      status: p.status,
      phase: p.phase,
      percent: p.percent,
      due_date: p.due_date,
      milestones: p.milestones.map((m) => ({ name: m.name, done: m.done, note: m.note })),
      roadblocks: p.roadblocks.map((r) => ({
        title: r.title, detail: r.detail, status: r.status,
        raised_at: r.raised_at, owner: r.owner?.name ?? "unassigned",
      })),
      tasks: p.tasks.map((t) => ({
        name: t.name, done: t.done, due_date: t.due_date,
        assignee: t.assignee?.name ?? "unassigned",
      })),
    }, settings?.analysis_prompt);

    const ran = new Date().toISOString();
    await db.from("projects")
      .update({ ai_summary: summary, ai_ran_at: ran })
      .eq("id", project_id);
    await log("ai", `Analysis refreshed for ${p.title}`, project_id);

    return NextResponse.json({ summary, ran_at: ran });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gemini couldn't complete the analysis. " + e.message },
      { status: 502 }
    );
  }
}

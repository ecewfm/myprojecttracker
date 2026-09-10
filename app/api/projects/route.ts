import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getProjects, getProjectSummaries, nextRef } from "@/lib/data";
import { zoneToday } from "@/lib/tz";
import { isSignedIn } from "@/lib/auth";

const DEFAULT_MILESTONES = [
  "Kickoff & discovery", "Requirements sign-off", "Design & architecture",
  "Database setup", "Core development", "API integration", "Frontend build",
  "QA & testing", "UAT with stakeholders", "Launch preparation",
];

/**
 * Board and timeline get summaries — a fraction of the payload. Pass
 * ?full=1 for the complete nested shape (used by the export).
 */
export async function GET(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const full = new URL(req.url).searchParams.get("full") === "1";
  return NextResponse.json(full ? await getProjects() : await getProjectSummaries(zoneToday()));
}

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data: project, error } = await db.from("projects").insert({
    ref: await nextRef(),
    title: body.title,
    status: body.status ?? "todo",
    phase: body.phase ?? "Project planning & design",
    owner_id: body.owner_id ?? null,
    due_date: body.due_date ?? null,
    priority: !!body.priority,
    shared: !!body.shared,
  }).select("id, ref").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const names: string[] = body.milestones?.length ? body.milestones : DEFAULT_MILESTONES;
  await db.from("milestones").insert(
    names.map((name, i) => ({ project_id: project.id, position: i + 1, name }))
  );

  return NextResponse.json(project, { status: 201 });
}

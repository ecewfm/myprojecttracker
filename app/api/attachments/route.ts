import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { upload, remove, listForProject, type Owner } from "@/lib/attachments";

export const maxDuration = 60;

function ownerFrom(form: FormData): Owner | null {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id) return null;
  if (kind === "milestone" || kind === "task" || kind === "roadblock") {
    return { kind, id };
  }
  return null;
}

/** Everything attached to a project, grouped by item. */
export async function GET(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const projectId = new URL(req.url).searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project required" }, { status: 400 });

  const grouped = await listForProject(projectId);
  return NextResponse.json({
    milestone: Object.fromEntries(grouped.milestone),
    task: Object.fromEntries(grouped.task),
    roadblock: Object.fromEntries(grouped.roadblock),
  });
}

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const form = await req.formData();
  const owner = ownerFrom(form);
  const projectId = String(form.get("project") ?? "");
  if (!owner || !projectId) {
    return NextResponse.json({ error: "missing item or project" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no files" }, { status: 400 });

  const added: string[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const res = await upload({ projectId, owner, file });
    if ("error" in res) problems.push(res.error);
    else added.push(res.id);
  }

  return NextResponse.json({ added: added.length, problems });
}

export async function DELETE(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await req.json();
  const err = await remove(id);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json({ ok: true });
}

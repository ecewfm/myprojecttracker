import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/** Rough grouping, so the filters mean something to read. */
const GROUP: Record<string, string> = {
  cliq_dm: "dm",
  cliq_update: "dm",
  digest: "digest",
  cliq_error: "error",
  notify_error: "error",
  ai_error: "error",
  notify_skipped: "error",
};

export async function GET(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const url = new URL(req.url);
  const group = url.searchParams.get("group") ?? "all";
  const projectId = url.searchParams.get("project");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60), 200);
  const before = url.searchParams.get("before");

  let q = db
    .from("activity_log")
    .select("id, kind, summary, meta, created_at, projects ( id, ref, title )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) q = q.eq("project_id", projectId);
  if (before) q = q.lt("created_at", before);

  // Filtering by group means filtering by the kinds inside it.
  if (group !== "all") {
    const kinds = Object.entries(GROUP)
      .filter(([, g]) => g === group)
      .map(([k]) => k);

    if (group === "other") {
      q = q.not("kind", "in", `(${Object.keys(GROUP).join(",")})`);
    } else if (kinds.length) {
      q = q.in("kind", kinds);
    }
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    group: GROUP[r.kind] ?? "other",
    summary: r.summary,
    at: r.created_at,
    project: r.projects ? { id: r.projects.id, ref: r.projects.ref, title: r.projects.title } : null,
    // Older rows have no meta — the page says so rather than showing a blank.
    detail: r.meta ?? null,
  }));

  return NextResponse.json({
    rows,
    // For "load more": the timestamp to page from.
    next: rows.length === limit ? rows[rows.length - 1].at : null,
  });
}

/** Counts per group, for the filter chips. */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data } = await db.from("activity_log").select("kind");
  const counts: Record<string, number> = { all: 0, dm: 0, digest: 0, error: 0, other: 0 };

  for (const r of data ?? []) {
    counts.all++;
    counts[GROUP[(r as any).kind] ?? "other"]++;
  }
  return NextResponse.json(counts);
}

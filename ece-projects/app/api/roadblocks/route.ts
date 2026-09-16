import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { notifyRoadblock } from "@/lib/reminders";

/** All open roadblocks across projects — powers the Roadblocks page. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data } = await db
    .from("roadblocks")
    .select(`
      id, title, detail, status, raised_at, target_date, note,
      roadblock_owners ( team_members ( id, name, email ) ),
      projects ( id, ref, title )
    `)
    .neq("status", "resolved")
    .order("raised_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json();

  const { data, error } = await db.from("roadblocks").insert({
    project_id: body.project_id,
    title: body.title,
    detail: body.detail ?? "",
    status: body.status ?? "open",
    target_date: body.target_date ?? null,
    note: body.note ?? "",
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const owners: string[] = Array.isArray(body.owner_ids)
    ? body.owner_ids.filter(Boolean)
    : body.owner_id ? [body.owner_id] : [];

  if (owners.length) {
    await db.from("roadblock_owners").insert(
      owners.map((member_id) => ({ roadblock_id: data.id, member_id }))
    );
  }

  await db.from("roadblock_events").insert({
    roadblock_id: data.id, to_status: body.status ?? "open", note: "Created",
  });

  // Cliq notification shouldn't block the response.
  notifyRoadblock(data.id, "opened").catch(() => {});

  return NextResponse.json(data, { status: 201 });
}

import { NextResponse } from "next/server";
import { getProject } from "@/lib/data";
import { buildWorkbook } from "@/lib/workbook";
import { isSignedIn } from "@/lib/auth";
import { zoneToday } from "@/lib/tz";

/** Download one project as a workbook — the same format import expects. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buf = buildWorkbook(p);
  const safe = p.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}_${zoneToday()}.xlsx"`,
    },
  });
}

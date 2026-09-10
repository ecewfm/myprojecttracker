import { NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/workbook";
import { isSignedIn } from "@/lib/auth";

/** A blank workbook for creating a project from scratch. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const buf = buildWorkbook(null);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="ECE-project-template.xlsx"',
    },
  });
}

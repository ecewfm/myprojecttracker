import { NextResponse } from "next/server";
import { previewImport, applyImport } from "@/lib/import";
import { isSignedIn } from "@/lib/auth";

export const maxDuration = 60;

/**
 * POST with mode=preview to see what would change, mode=apply to write it.
 * Nothing is written during a preview.
 */
export async function POST(req: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  const notify = String(form.get("notify") ?? "false") === "true";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const buf = await file.arrayBuffer();

  try {
    if (mode === "apply") {
      return NextResponse.json(await applyImport(buf, { notify }));
    }
    return NextResponse.json(await previewImport(buf));
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? "That file couldn't be read. Is it the exported format?" },
      { status: 400 }
    );
  }
}

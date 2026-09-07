import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";

/**
 * Tells you why share links aren't appearing in Cliq messages.
 * Reports config and table state without exposing secrets.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const appUrl = process.env.APP_URL ?? null;

  // Does the share_links table exist and is it readable?
  let tableOk = false;
  let tableError: string | null = null;
  let linkCount = 0;
  try {
    const { count, error } = await db
      .from("share_links")
      .select("id", { count: "exact", head: true });
    if (error) tableError = error.message;
    else { tableOk = true; linkCount = count ?? 0; }
  } catch (e: any) { tableError = e.message; }

  // Does the build include the new code? This constant only exists in it.
  const buildMarker = "auto-issue-v1";

  return NextResponse.json({
    build: buildMarker,
    APP_URL: {
      set: !!appUrl,
      value: appUrl,
      looks_right:
        !!appUrl && appUrl.startsWith("https://") && !appUrl.endsWith("/"),
      note: !appUrl
        ? "MISSING — this is why messages have no link. Add APP_URL in Vercel."
        : !appUrl.startsWith("https://")
        ? "Missing https:// prefix."
        : appUrl.endsWith("/")
        ? "Remove the trailing slash."
        : "Looks correct.",
    },
    share_links_table: {
      ok: tableOk,
      error: tableError,
      existing_links: linkCount,
      note: tableOk
        ? "Table is present."
        : "Table missing or unreadable — run migration-004.sql in Supabase.",
    },
  });
}

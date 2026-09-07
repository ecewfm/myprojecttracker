import { NextResponse } from "next/server";
import { isSignedIn } from "@/lib/auth";

/**
 * Temporary diagnostic. Returns the raw field names and one sample row
 * from the Zoho Employees report, so we can map job position and account
 * correctly. Delete this route once the mapping is fixed.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";

  // get a token
  const tokenRes = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const tokenJson = await tokenRes.json();
  const token = tokenJson.access_token;
  if (!token) return NextResponse.json({ error: "token failed", detail: tokenJson }, { status: 502 });

  const owner  = process.env.ZOHO_CREATOR_OWNER!;
  const app    = process.env.ZOHO_CREATOR_APP!;
  const report = process.env.ZOHO_CREATOR_REPORT!;
  const base   = process.env.ZOHO_CREATOR_BASE || "https://creator.zoho.com";

  const res = await fetch(
    `${base}/api/v2/${owner}/${app}/report/${report}?from=1&limit=1`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  const json = await res.json();
  const row = json.data?.[0] ?? {};

  // Return the field names and the sample row so we can see the truth.
  return NextResponse.json({
    field_names: Object.keys(row),
    sample_row: row,
  });
}

/**
 * Zoho OAuth + Cliq messaging + Creator roster pull.
 * All three share one refresh token from the Zoho API console.
 */

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Zoho token failed: ${JSON.stringify(json)}`);

  cached = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Send a Cliq direct message. The Cliq username is the person's Zoho email. */
export async function cliqDM(email: string, text: string) {
  const token = await accessToken();
  const res = await fetch(
    `https://cliq.zoho.com/api/v2/buddies/${encodeURIComponent(email)}/message`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) throw new Error(`Cliq DM failed (${res.status}): ${await res.text()}`);
  return true;
}

/** Post to a Cliq channel by name, e.g. "wfm-projects". */
export async function cliqChannel(channel: string, text: string) {
  const token = await accessToken();
  const res = await fetch(
    `https://cliq.zoho.com/api/v2/channelsbyname/${encodeURIComponent(channel)}/message`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) throw new Error(`Cliq channel post failed (${res.status})`);
  return true;
}

/** Pull the employee roster from Zoho Creator. */
export async function fetchRoster(): Promise<
  { name: string; email: string; zoho_id: string }[]
> {
  const token = await accessToken();
  const owner  = process.env.ZOHO_CREATOR_OWNER!;   // ececonsultinggroup
  const app    = process.env.ZOHO_CREATOR_APP!;     // ece-time-tracker
  const report = process.env.ZOHO_CREATOR_REPORT!;  // View_Employees_View_Only
  const base   = process.env.ZOHO_CREATOR_BASE || "https://creator.zoho.com";

  const out: { name: string; email: string; zoho_id: string }[] = [];
  let from = 1;
  const limit = 200;

  // Creator paginates; walk until a short page comes back.
  for (let page = 0; page < 30; page++) {
    const url =
      `${base}/api/v2/${owner}/${app}/report/${report}` +
      `?from=${from}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) throw new Error(`Creator fetch failed (${res.status}): ${await res.text()}`);

    const json = await res.json();
    const rows: any[] = json.data ?? [];
    for (const r of rows) {
      // Field names vary by form. Adjust the right-hand side to match yours.
      const email =
        r.Email_Address || r.Email || r.Zoho_Email || r.Work_Email || "";
      const name =
        r.Employee_Name?.display_value ||
        [r.Employee_Name?.first_name, r.Employee_Name?.last_name].filter(Boolean).join(" ") ||
        r.Full_Name || r.Name || "";
      if (email && name) out.push({ name, email: email.toLowerCase(), zoho_id: r.ID });
    }
    if (rows.length < limit) break;
    from += limit;
  }
  return out;
}

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

/**
 * Post to a Cliq channel by its unique name.
 *
 * This org routes channel calls through a company id — the endpoint shown
 * in a channel's Connectors tab is
 *   https://cliq.zoho.com/company/{ZOHO_COMPANY_ID}/api/v2/channelsbyname/{name}/message
 * The generic /api/v2/... path (without the company segment) returns 401
 * here, so ZOHO_COMPANY_ID must be set. It falls back to the generic path
 * if the id isn't configured.
 */
export async function cliqChannel(channel: string, text: string) {
  const token = await accessToken();
  const company = process.env.ZOHO_COMPANY_ID;

  const url = company
    ? `https://cliq.zoho.com/company/${company}/api/v2/channelsbyname/${encodeURIComponent(channel)}/message`
    : `https://cliq.zoho.com/api/v2/channelsbyname/${encodeURIComponent(channel)}/message`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cliq channel post failed (${res.status}): ${body}`);
  }
  return true;
}

export interface RosterPerson {
  name: string;
  email: string;
  zoho_id: string;
  job_position: string | null;
  account: string | null;
  site: string | null;
}

/**
 * Read one row from the Zoho Creator response into our shape.
 * Field names are the API names from the View_Employees form. If a sync
 * comes back with a column blank, log a row (see the roster route) and
 * adjust the right-hand names here to match what Zoho actually returns.
 */
function mapRow(r: any): RosterPerson | null {
  const email =
    r.Zoho_Email || r.Email_Address || r.Email || r.Work_Email || "";

  // Name: the form stores first/middle/last separately.
  const name =
    r.Employee_Name?.display_value ||
    [r.First_Name, r.Middle_Name, r.Last_Name].filter(Boolean).join(" ").trim() ||
    [r.Employee_Name?.first_name, r.Employee_Name?.last_name].filter(Boolean).join(" ") ||
    r.Full_Name || r.Name || "";

  if (!email || !name) return null;

  // A Zoho lookup field arrives as an object with display_value; a plain
  // text field arrives as a string. Handle both.
  const flat = (v: any): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "object" && v.display_value) return String(v.display_value).trim() || null;
    return null;
  };

  return {
    name,
    email: email.toLowerCase(),
    zoho_id: r.ID,
    job_position: flat(r.Job_Position) ?? flat(r.Designation) ?? flat(r.Title),
    account:      flat(r.Account) ?? flat(r.Program) ?? flat(r.LOB),
    site:         flat(r.Site) ?? flat(r.Location),
  };
}

/** Pull the whole employee roster from Zoho Creator. */
export async function fetchRoster(): Promise<RosterPerson[]> {
  const token = await accessToken();
  const owner  = process.env.ZOHO_CREATOR_OWNER!;
  const app    = process.env.ZOHO_CREATOR_APP!;
  const report = process.env.ZOHO_CREATOR_REPORT!;
  const base   = process.env.ZOHO_CREATOR_BASE || "https://creator.zoho.com";

  const out: RosterPerson[] = [];
  let from = 1;
  const limit = 200;

  for (let page = 0; page < 60; page++) {
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
      const person = mapRow(r);
      if (person) out.push(person);
    }
    if (rows.length < limit) break;
    from += limit;
  }
  return out;
}

/**
 * Search the Zoho roster by name, email, job position, or account.
 * Used by the Team page's live "search and add" box, so it doesn't have
 * to hold the whole company in the browser. Zoho Creator supports a
 * criteria string; we fetch and filter here to keep the field-name
 * handling in one place (mapRow) rather than duplicating it in a query.
 */
export async function searchRoster(query: string): Promise<RosterPerson[]> {
  const all = await fetchRoster();
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, 50);

  const hit = (p: RosterPerson) =>
    p.name.toLowerCase().includes(q) ||
    p.email.toLowerCase().includes(q) ||
    (p.job_position ?? "").toLowerCase().includes(q) ||
    (p.account ?? "").toLowerCase().includes(q) ||
    (p.site ?? "").toLowerCase().includes(q);

  return all.filter(hit).slice(0, 50);
}

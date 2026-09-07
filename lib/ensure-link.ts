import { db } from "./supabase";
import { makeToken } from "./share";

/**
 * Return the share URL for one person on one project, creating the link
 * if they don't have an active one yet.
 *
 * Called whenever someone is assigned work, so the link exists by the time
 * the Cliq message goes out — nobody gets told about a task they have no
 * way to close. Returns null if APP_URL isn't configured, so callers can
 * fall back to a message without a link rather than sending a broken one.
 */
export async function ensureShareUrl(
  projectId: string,
  memberId: string
): Promise<string | null> {
  const base = process.env.APP_URL;
  if (!base) return null;

  const { data: existing } = await db
    .from("share_links")
    .select("token, revoked")
    .eq("project_id", projectId)
    .eq("member_id", memberId)
    .maybeSingle();

  // An active link — reuse it. Re-issuing on every assignment would
  // invalidate the URL people already have saved.
  if (existing && !existing.revoked) {
    return `${base.replace(/\/$/, "")}/p/${existing.token}`;
  }

  // Revoked links stay revoked. If you pulled someone's access on purpose,
  // assigning them a task shouldn't quietly hand it back.
  if (existing?.revoked) return null;

  const token = makeToken();
  const { error } = await db.from("share_links").insert({
    project_id: projectId,
    member_id: memberId,
    token,
  });
  if (error) return null;

  return `${base.replace(/\/$/, "")}/p/${token}`;
}

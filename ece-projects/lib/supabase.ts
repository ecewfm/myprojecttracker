import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client. Uses the service-role key, so this module
 * must never be imported into a client component.
 */
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function log(
  kind: string,
  summary: string,
  projectId?: string | null,
  meta?: Record<string, unknown>
) {
  await db.from("activity_log").insert({
    kind, summary, project_id: projectId ?? null, meta: meta ?? null,
  });
}

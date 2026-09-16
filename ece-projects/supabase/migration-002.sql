-- ECE Projects — migration 002
-- Adds employee detail columns and custom AI prompt fields.
-- Run this once in the Supabase SQL editor. It's safe to run on an
-- existing database; every statement uses "if not exists".

-- ── team_members: richer employee detail from Zoho ──────────
alter table team_members add column if not exists job_position text;
alter table team_members add column if not exists account       text;
alter table team_members add column if not exists site          text;

-- Filtering by role happens often enough to index it.
create index if not exists team_members_job_position_idx
  on team_members (job_position);

-- ── settings: user-authored AI prompts ─────────────────────
-- Both default to empty. Empty means the analysis and digest behave
-- exactly as they did before — the text is added to the instructions,
-- never replaces them.
alter table settings add column if not exists analysis_prompt text not null default '';
alter table settings add column if not exists digest_prompt   text not null default '';

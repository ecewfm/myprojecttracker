-- ECE Projects — migration 012
-- Description and a one-line progress read per project, plus the setting
-- that decides whether the weekly email sends itself.
-- Safe to run on an existing database.

-- ── Per project ────────────────────────────────────────────
-- description is yours to write; the app never overwrites it.
alter table projects add column if not exists description text not null default '';

-- The one-line read shown in the table and the weekly email. Separate from
-- ai_summary, which holds the longer analysis in the project panel.
alter table projects add column if not exists progress_line text not null default '';
alter table projects add column if not exists progress_line_at timestamptz;

-- Set when you reword the line yourself. A refresh skips these, so your
-- wording isn't thrown away by the next automatic run.
alter table projects add column if not exists progress_line_mine boolean not null default false;

-- ── Weekly email ───────────────────────────────────────────
-- 'auto' sends on the configured day and hour; 'manual' only sends when you
-- press Send in the preview.
alter table settings add column if not exists digest_mode text not null default 'auto';

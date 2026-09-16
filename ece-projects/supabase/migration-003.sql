-- ECE Projects — migration 003
-- Milestone assignees, per-project Cliq channel, and per-project weekly email.
-- Safe to run on an existing database; every statement guards with "if not exists".

-- ── milestones: an optional assignee ───────────────────────
alter table milestones
  add column if not exists assignee_id uuid references team_members(id) on delete set null;

-- ── projects: Cliq channel + per-project email settings ────
alter table projects add column if not exists cliq_channel text;

alter table projects add column if not exists email_enabled     boolean not null default false;
alter table projects add column if not exists email_day         int not null default 5;   -- 1=Mon … 7=Sun
alter table projects add column if not exists email_hour        int not null default 9;   -- Manila hour
alter table projects add column if not exists email_to          text[] not null default '{}';
alter table projects add column if not exists email_cc          text[] not null default '{}';
alter table projects add column if not exists email_subject     text;                      -- template; {date} token allowed
alter table projects add column if not exists email_last_sent   date;

-- ECE Projects — migration 007
-- Multiple assignees on milestones and action items, plus the new
-- settings for the deadline window and DM sending hours.
-- Safe to run on an existing database.

-- ── Many assignees per milestone ───────────────────────────
create table if not exists milestone_assignees (
  milestone_id uuid not null references milestones(id) on delete cascade,
  member_id    uuid not null references team_members(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (milestone_id, member_id)
);
create index if not exists milestone_assignees_member_idx
  on milestone_assignees (member_id);

-- ── Many assignees per action item ─────────────────────────
create table if not exists task_assignees (
  task_id    uuid not null references tasks(id) on delete cascade,
  member_id  uuid not null references team_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, member_id)
);
create index if not exists task_assignees_member_idx
  on task_assignees (member_id);

-- ── Carry the existing single assignees across ─────────────
-- Anyone already assigned keeps their assignment; nothing is lost.
insert into milestone_assignees (milestone_id, member_id)
select id, assignee_id from milestones
where assignee_id is not null
on conflict do nothing;

insert into task_assignees (task_id, member_id)
select id, assignee_id from tasks
where assignee_id is not null
on conflict do nothing;

-- The old assignee_id columns stay in place but are no longer read.
-- Drop them later if you want:
--   alter table milestones drop column assignee_id;
--   alter table tasks drop column assignee_id;

-- ── Per-item nudge tracking, now per person ────────────────
-- One person going quiet shouldn't stop the others being reminded.
alter table milestone_assignees add column if not exists last_nudge_at timestamptz;
alter table milestone_assignees add column if not exists nudge_count int not null default 0;
alter table task_assignees      add column if not exists last_nudge_at timestamptz;
alter table task_assignees      add column if not exists nudge_count int not null default 0;

-- ── Settings ───────────────────────────────────────────────
alter table settings add column if not exists nearing_days int not null default 5;
alter table settings add column if not exists dm_start_hour int not null default 9;
alter table settings add column if not exists dm_end_hour   int not null default 17;

alter table milestone_assignees enable row level security;
alter table task_assignees      enable row level security;

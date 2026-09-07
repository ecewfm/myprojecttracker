-- ECE Projects — database schema
-- Run this once in the Supabase SQL editor.

-- ─────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────
create type project_status as enum
  ('todo','pending','dev','testing','done','impl','scrap');

create type roadblock_status as enum
  ('open','progress','escalated','resolved');

-- ─────────────────────────────────────────────
-- Team (synced from Zoho, editable in-app)
-- ─────────────────────────────────────────────
create table team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,          -- doubles as the Cliq username
  zoho_id     text,                          -- employee record id from Zoho Creator
  active      boolean not null default true,
  synced_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────
create table projects (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,         -- short code shown on the card, e.g. HD8F
  title        text not null,
  status       project_status not null default 'todo',
  phase        text,                         -- "Current phase" line on the card
  owner_id     uuid references team_members(id) on delete set null,
  due_date     date,
  priority     boolean not null default false,
  shared       boolean not null default false,
  labels       jsonb not null default '[]'::jsonb,  -- [{name,color}]
  ai_summary   text,
  ai_ran_at    timestamptz,
  reminders_on boolean not null default true,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Extra owners for shared projects
create table project_members (
  project_id uuid references projects(id) on delete cascade,
  member_id  uuid references team_members(id) on delete cascade,
  primary key (project_id, member_id)
);

-- ─────────────────────────────────────────────
-- Milestones (with the notes field)
-- ─────────────────────────────────────────────
create table milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  position     int  not null,
  name         text not null,
  note         text not null default '',
  done         boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index on milestones (project_id, position);

-- ─────────────────────────────────────────────
-- Subprojects + their own milestones
-- ─────────────────────────────────────────────
create table subprojects (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  owner_id    uuid references team_members(id) on delete set null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create table subproject_milestones (
  id            uuid primary key default gen_random_uuid(),
  subproject_id uuid not null references subprojects(id) on delete cascade,
  position      int not null,
  name          text not null,
  note          text not null default '',
  done          boolean not null default false,
  completed_at  timestamptz
);
create index on subproject_milestones (subproject_id, position);

-- ─────────────────────────────────────────────
-- Action items
-- ─────────────────────────────────────────────
create table tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  subproject_id uuid references subprojects(id) on delete cascade,
  name          text not null,
  assignee_id   uuid references team_members(id) on delete set null,
  due_date      date,
  done          boolean not null default false,
  completed_at  timestamptz,
  last_nudge_at timestamptz,
  nudge_count   int not null default 0,
  created_at    timestamptz not null default now()
);
create index on tasks (project_id);
create index on tasks (assignee_id) where done = false;

-- ─────────────────────────────────────────────
-- Roadblocks
-- ─────────────────────────────────────────────
create table roadblocks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  title         text not null,
  detail        text not null default '',
  status        roadblock_status not null default 'open',
  owner_id      uuid references team_members(id) on delete set null,
  target_date   date,
  raised_at     timestamptz not null default now(),
  resolved_at   timestamptz,
  last_nudge_at timestamptz,
  nudge_count   int not null default 0
);
create index on roadblocks (project_id);
create index on roadblocks (status) where status <> 'resolved';

-- Audit trail of status changes
create table roadblock_events (
  id           uuid primary key default gen_random_uuid(),
  roadblock_id uuid not null references roadblocks(id) on delete cascade,
  from_status  roadblock_status,
  to_status    roadblock_status not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Settings (single row)
-- ─────────────────────────────────────────────
create table settings (
  id                    int primary key default 1,
  reminder_base         text not null default 'daily',      -- daily | 2days | weekdays
  escalate_within_days  int  not null default 3,
  reminder_escalated    text not null default 'twice_daily',
  mention_in_group      boolean not null default false,
  copy_manager          boolean not null default true,
  notify_on_roadblock   boolean not null default true,
  nudge_open_roadblocks boolean not null default true,
  digest_day            int  not null default 5,            -- 1=Mon … 7=Sun
  digest_hour           int  not null default 9,            -- local hour, Manila
  digest_recipients     text[] not null default '{}',
  digest_sections       jsonb not null default
    '{"progress":true,"roadblocks":true,"overdue":true,"ai":true}'::jsonb,
  custom_labels         jsonb not null default '[]'::jsonb,
  constraint settings_singleton check (id = 1)
);
insert into settings (id) values (1) on conflict do nothing;

-- ─────────────────────────────────────────────
-- Automation log
-- ─────────────────────────────────────────────
create table activity_log (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,     -- cliq_dm | digest | calendar | ai | roadblock
  summary    text not null,
  project_id uuid references projects(id) on delete set null,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index on activity_log (created_at desc);

-- ─────────────────────────────────────────────
-- Progress: percentage derived from milestones
-- ─────────────────────────────────────────────
create or replace view project_progress as
select
  p.id as project_id,
  count(m.id) filter (where m.done) as done_count,
  count(m.id)                       as total_count,
  case when count(m.id) = 0 then 0
       else round(100.0 * count(m.id) filter (where m.done) / count(m.id))
  end as percent
from projects p
left join milestones m on m.project_id = p.id
group by p.id;

-- keep updated_at fresh
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger projects_touch before update on projects
for each row execute function touch_updated_at();

-- ─────────────────────────────────────────────
-- Security: this app is single-user and talks to
-- Supabase only through the service-role key on
-- the server. RLS stays on with no public policy,
-- so the anon key can read nothing.
-- ─────────────────────────────────────────────
alter table team_members          enable row level security;
alter table projects              enable row level security;
alter table project_members       enable row level security;
alter table milestones            enable row level security;
alter table subprojects           enable row level security;
alter table subproject_milestones enable row level security;
alter table tasks                 enable row level security;
alter table roadblocks            enable row level security;
alter table roadblock_events      enable row level security;
alter table settings              enable row level security;
alter table activity_log          enable row level security;

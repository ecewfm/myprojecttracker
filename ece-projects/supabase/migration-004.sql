-- ECE Projects — migration 004
-- Public per-person share links, plus an audit trail of what people submit.
-- Safe to run on an existing database.

-- ── One link per person per project ────────────────────────
create table if not exists share_links (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  member_id      uuid not null references team_members(id) on delete cascade,
  token          text not null unique,
  revoked        boolean not null default false,
  created_at     timestamptz not null default now(),
  last_opened_at timestamptz,
  open_count     int not null default 0,
  unique (project_id, member_id)
);
create index if not exists share_links_token_idx on share_links (token) where revoked = false;

-- ── Everything submitted through a share link ──────────────
-- This is the audit trail: who did what, when, and what the AI made of it.
create table if not exists submissions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  member_id   uuid references team_members(id) on delete set null,
  kind        text not null,          -- task_closed | milestone_closed | roadblock_added | note_added
  subject     text,                   -- name of the task/milestone/roadblock touched
  note        text not null default '',
  ai_summary  text,
  seen        boolean not null default false,   -- drives the badge in the board
  created_at  timestamptz not null default now()
);
create index if not exists submissions_unseen_idx on submissions (seen) where seen = false;
create index if not exists submissions_project_idx on submissions (project_id, created_at desc);

alter table share_links enable row level security;
alter table submissions enable row level security;

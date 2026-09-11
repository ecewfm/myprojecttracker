-- ECE Projects — migration 009
-- Roadblocks get several owners and a notes field, matching how milestones
-- and action items already work.
-- Safe to run on an existing database.

-- ── Many owners per roadblock ──────────────────────────────
create table if not exists roadblock_owners (
  roadblock_id  uuid not null references roadblocks(id) on delete cascade,
  member_id     uuid not null references team_members(id) on delete cascade,
  last_nudge_at timestamptz,
  nudge_count   int not null default 0,
  created_at    timestamptz not null default now(),
  primary key (roadblock_id, member_id)
);
create index if not exists roadblock_owners_member_idx
  on roadblock_owners (member_id);
create index if not exists roadblock_owners_roadblock_idx
  on roadblock_owners (roadblock_id);

-- Carry the existing single owner across so nothing is lost.
insert into roadblock_owners (roadblock_id, member_id, last_nudge_at, nudge_count)
select id, owner_id, last_nudge_at, nudge_count
from roadblocks
where owner_id is not null
on conflict do nothing;

-- owner_id stays in place, unused, in case you want to look back.
-- Drop it later with:
--   alter table roadblocks drop column owner_id;

-- ── Notes on a roadblock ───────────────────────────────────
-- Separate from detail on purpose: detail is what the blocker is, notes are
-- what has happened since — who was chased, what they said.
alter table roadblocks add column if not exists note text not null default '';

alter table roadblock_owners enable row level security;

-- ECE Projects — migration 005
-- Sub-milestones (milestones nested under a parent) and notes on action items.
-- Safe to run on an existing database.

-- ── Sub-milestones ─────────────────────────────────────────
-- A milestone with a parent_id is a sub-milestone. Progress counts only
-- top-level milestones (parent_id is null), so adding sub-items never
-- moves the percentage on its own.
alter table milestones
  add column if not exists parent_id uuid references milestones(id) on delete cascade;

create index if not exists milestones_parent_idx on milestones (parent_id);

-- ── Notes on action items ──────────────────────────────────
alter table tasks add column if not exists note text not null default '';

-- ── Progress view: top-level milestones only ───────────────
create or replace view project_progress as
select
  p.id as project_id,
  count(m.id) filter (where m.done) as done_count,
  count(m.id)                       as total_count,
  case when count(m.id) = 0 then 0
       else round(100.0 * count(m.id) filter (where m.done) / count(m.id))
  end as percent
from projects p
left join milestones m
  on m.project_id = p.id
 and m.parent_id is null
group by p.id;

-- The old subprojects tables are no longer used by the app. They're left
-- in place rather than dropped, so nothing is lost if you had data there.
-- To remove them once you're sure:
--   drop table if exists subproject_milestones;
--   drop table if exists subprojects;

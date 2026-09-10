-- ECE Projects — clean up duplicate rows from the failed imports
--
-- The importer used to insert any row with a blank ID, so an import that
-- timed out part-way and was retried created a second (or third) copy of
-- the same milestone. This removes the copies and keeps the original.
--
-- Run the SELECTs first to see what would go. Only then run the DELETEs.

-- ── 1. What duplicate milestones exist? ────────────────────
select
  p.title                as project,
  m.name                 as milestone,
  coalesce(par.name, '—') as parent,
  count(*)               as copies
from milestones m
join projects p on p.id = m.project_id
left join milestones par on par.id = m.parent_id
group by p.title, m.name, coalesce(par.name, '—'), m.parent_id, m.project_id
having count(*) > 1
order by copies desc, project, milestone;

-- ── 2. Remove the copies, keeping the oldest of each ────────
-- "Oldest" is the one your board has been using, so its notes, assignees
-- and completion state are the ones worth keeping.
with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, parent_id, lower(trim(name))
      order by created_at, position, id
    ) as rn
  from milestones
)
delete from milestones
where id in (select id from ranked where rn > 1);

-- ── 3. Same for action items ───────────────────────────────
with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, lower(trim(name))
      order by created_at, id
    ) as rn
  from tasks
)
delete from tasks
where id in (select id from ranked where rn > 1);

-- ── 4. Same for roadblocks ─────────────────────────────────
with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, lower(trim(title))
      order by raised_at, id
    ) as rn
  from roadblocks
)
delete from roadblocks
where id in (select id from ranked where rn > 1);

-- ── 5. Tidy the milestone ordering afterwards ──────────────
with renumbered as (
  select
    id,
    row_number() over (
      partition by project_id, coalesce(parent_id::text, 'root')
      order by position, created_at
    ) as pos
  from milestones
)
update milestones m
set position = r.pos
from renumbered r
where m.id = r.id and m.position <> r.pos;

-- ── 6. Confirm it worked — this should return no rows ──────
select p.title, m.name, count(*)
from milestones m
join projects p on p.id = m.project_id
group by p.title, m.name, m.parent_id, m.project_id
having count(*) > 1;

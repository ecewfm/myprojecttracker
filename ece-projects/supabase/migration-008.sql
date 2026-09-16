-- ECE Projects — migration 008
-- Indexes for the paths that run on every board, timeline and panel load.
-- Postgres was scanning these tables in full; on a few hundred rows that's
-- survivable, but it grows with every project.
-- Safe to run on an existing database.

-- Every nested select filters children by their parent id.
create index if not exists milestones_project_idx  on milestones (project_id);
create index if not exists tasks_project_idx       on tasks (project_id);
create index if not exists roadblocks_project_idx  on roadblocks (project_id);
create index if not exists project_members_project_idx on project_members (project_id);

-- The board excludes archived projects and orders by creation.
create index if not exists projects_active_idx
  on projects (archived, created_at);

-- The reminder pass walks the assignee tables looking for open work.
create index if not exists milestone_assignees_milestone_idx
  on milestone_assignees (milestone_id);
create index if not exists task_assignees_task_idx
  on task_assignees (task_id);

-- The deadlines view filters on due dates for items that aren't done.
create index if not exists milestones_open_due_idx
  on milestones (due_date) where done = false;
create index if not exists tasks_open_due_idx
  on tasks (due_date) where done = false;
create index if not exists roadblocks_open_target_idx
  on roadblocks (target_date) where status <> 'resolved';

-- Notifications badge counts unseen rows on every poll.
create index if not exists submissions_seen_created_idx
  on submissions (seen, created_at desc);

analyze;

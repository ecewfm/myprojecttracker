-- ECE Projects — migration 006
-- Deadlines on milestones and sub-milestones.
-- Safe to run on an existing database.

alter table milestones add column if not exists due_date date;
alter table milestones add column if not exists last_nudge_at timestamptz;
alter table milestones add column if not exists nudge_count int not null default 0;

-- Reminders scan for open milestones with an assignee; index that path.
create index if not exists milestones_due_idx
  on milestones (due_date)
  where done = false and due_date is not null;

-- ECE Projects — migration 010
-- Image attachments on milestones, sub-milestones, action items and
-- roadblocks. Files live in Supabase Storage; this table records what
-- belongs to what.
--
-- TWO STEPS. Run the SQL below, then create the bucket (instructions at
-- the bottom) — the bucket can't be made from SQL.

create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,

  -- Exactly one of these is set. A check constraint would be stricter, but
  -- it would also make the insert fragile for no real gain.
  milestone_id uuid references milestones(id) on delete cascade,
  task_id      uuid references tasks(id)      on delete cascade,
  roadblock_id uuid references roadblocks(id) on delete cascade,

  path         text not null,          -- where it sits in the bucket
  filename     text not null,          -- what the uploader called it
  mime         text not null,
  bytes        int  not null,

  -- Who added it. Null when it came from the signed-in owner rather than
  -- someone using a share link.
  uploaded_by  uuid references team_members(id) on delete set null,

  -- Cleared once the file has been mentioned in a Cliq message, so
  -- reminders don't re-send the same screenshots every morning.
  announced_at timestamptz,

  created_at   timestamptz not null default now()
);

create index if not exists attachments_milestone_idx on attachments (milestone_id);
create index if not exists attachments_task_idx      on attachments (task_id);
create index if not exists attachments_roadblock_idx on attachments (roadblock_id);
create index if not exists attachments_project_idx   on attachments (project_id);
create index if not exists attachments_pending_idx
  on attachments (announced_at) where announced_at is null;

alter table attachments enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Create the storage bucket
-- ─────────────────────────────────────────────────────────────
-- In Supabase: Storage → New bucket
--
--   Name:            attachments
--   Public bucket:   OFF
--   File size limit: 10 MB
--   Allowed MIME:    image/jpeg, image/png, image/gif, image/webp
--
-- Keep it private. The app serves files through signed URLs that expire,
-- so an image can't be reached by guessing a path, and the app decides who
-- gets a link. A public bucket would mean anyone holding a URL could read
-- it forever, including after you removed their access.

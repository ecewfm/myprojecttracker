-- ECE Projects — migration 011
-- Remember when reminders last went out, so the send survives a cron that
-- doesn't fire on the hour.
--
-- Background: the schedule is "0 * * * *" (hourly), but Vercel's Hobby plan
-- runs cron jobs roughly once a day at a time of its choosing — which is why
-- the digest logged at 08:44 one day and 08:54 the next. Reminders required
-- the local hour to equal the configured send hour exactly, so a run at 08:54
-- against a 09:00 setting never matched, and nothing was ever sent.
--
-- These columns let a run ask "has today's send already happened?" instead of
-- "is it exactly nine o'clock?".

alter table settings add column if not exists last_reminder_run date;
alter table settings add column if not exists last_second_run   date;

-- Stamped on every cron invocation, including ones that send nothing. The
-- gap between stamps tells the app whether the cron is really running hourly
-- or only once a day, so it can behave sensibly either way without being
-- told which plan you're on.
alter table settings add column if not exists last_cron_at timestamptz;

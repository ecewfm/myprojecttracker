/**
 * All scheduling and display go through here.
 *
 * The app used to do fixed-offset arithmetic for Manila (UTC+8), which works
 * only because the Philippines has no daylight saving. US Eastern does, so a
 * fixed offset would drift by an hour for most of the year. These helpers use
 * Intl with a named zone instead, which follows the DST rules on its own.
 *
 * Set APP_TIMEZONE to any IANA name to move the whole app to another zone.
 */
export const TZ = process.env.APP_TIMEZONE || "America/New_York";

/** Short label for the UI, e.g. "EST" or "EDT" depending on the date. */
export function zoneLabel(d = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? TZ;
}

interface Parts {
  year: number; month: number; day: number;
  hour: number; minute: number;
  /** 1 = Monday … 7 = Sunday, matching the digest_day setting. */
  weekday: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The wall-clock date and time in the app's zone. */
export function zoneParts(d = new Date()): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // "24" appears at midnight in some environments; normalise it.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")) + 1,
  };
}

/** Today's date in the app's zone, as YYYY-MM-DD. */
export function zoneToday(d = new Date()): string {
  const p = zoneParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 1 = Monday … 7 = Sunday, in the app's zone. */
export function zoneWeekday(d = new Date()): number {
  return zoneParts(d).weekday;
}

/** Hour 0-23 in the app's zone. */
export function zoneHour(d = new Date()): number {
  return zoneParts(d).hour;
}

export function isWeekdayInZone(d = new Date()): boolean {
  const w = zoneWeekday(d);
  return w >= 1 && w <= 5;
}

/**
 * Whole days from today until a YYYY-MM-DD date, counted in the app's zone.
 * Negative means the date has passed.
 */
export function daysUntilInZone(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${zoneToday(now)}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

/** For display: a timestamp rendered in the app's zone. */
export function formatInZone(
  value: string | Date,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(d);
}

/** Date only, in the app's zone. */
export function formatDateInZone(value: string | Date): string {
  return formatInZone(value, { month: "short", day: "numeric", year: "numeric" });
}

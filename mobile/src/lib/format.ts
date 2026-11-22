import { strings } from "./strings";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const t = strings.time;

/** "3 h ago", "yesterday", "2 weeks ago"… */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return t.justNow;
  if (diff < HOUR) return t.minutes(Math.floor(diff / MINUTE));
  if (diff < DAY) return t.hours(Math.floor(diff / HOUR));
  if (diff < 2 * DAY) return t.yesterday;
  if (diff < 7 * DAY) return t.days(Math.floor(diff / DAY));
  if (diff < 30 * DAY) return t.weeks(Math.floor(diff / (7 * DAY)));
  if (diff < 365 * DAY) return t.months(Math.floor(diff / (30 * DAY)));
  return t.years(Math.floor(diff / (365 * DAY)));
}

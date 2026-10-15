/**
 * Calendar dates of the station (`YYYY-MM-DD`), as the grid API sends them (design §10.2). They are
 * plain dates without a zone: arithmetic is done in UTC, where every day has 24 hours.
 */

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Today's date in an IANA zone, for example the station zone. */
export function stationToday(zone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) {
    return false;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().startsWith(value);
}

function toUtc(date: string): number {
  if (!isLocalDate(date)) {
    throw new Error(`Not a date as YYYY-MM-DD: "${date}".`);
  }
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday, as the grid API counts weekdays. */
export function weekdayOf(date: string): number {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** A date at noon UTC, for formatting a calendar date without a zone shifting its day. */
export function localDateAsUtcNoon(date: string): Date {
  return new Date(toUtc(date) + DAY_MS / 2);
}

// 2024-01-01 was a Monday, so day N of the week is January N.
const MONDAY_UTC = Date.UTC(2024, 0, 1);

/** The name of a weekday (1 = Monday) in a locale, for example "Mon" or "Monday". */
export function weekdayName(
  weekday: number,
  locale: string,
  style: 'short' | 'long' = 'short',
): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    MONDAY_UTC + (weekday - 1) * DAY_MS,
  );
}

/** `HH:00` for an hour of the day. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/**
 * The instant (ISO 8601 UTC) at which a station date begins in an IANA zone, for API ranges such
 * as the track plan's `from` and `to`. Computed from the zone's offset at that moment, so a zone
 * with a half-hour offset or daylight saving time is handled.
 */
export function stationMidnightUtc(date: string, zone: string): string {
  const wall = toUtc(date);
  // The offset at the wall time read as UTC may be on the other side of a DST change; the offset
  // at the first guess is the one in force at the station's midnight.
  const guess = wall - zoneOffsetMs(wall, zone);
  return new Date(wall - zoneOffsetMs(guess, zone)).toISOString();
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

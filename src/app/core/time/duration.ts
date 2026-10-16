/** `m:ss`, or `h:mm:ss` from one hour, for track lengths and player times. */
export function formatSeconds(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** A duration in milliseconds as the API sends it (`duration_ms`). */
export function formatDurationMs(ms: number): string {
  return formatSeconds(ms / 1000);
}

/** `H:MM:SS` with unbounded hours (`27:14:03`), for how long a state has lasted. */
export function formatElapsedMs(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * The length of a plan item or a playing track from its in and out points in the file. Since cue
 * points (backend phase 22) an item may start after 0, so the out point alone is not its length.
 * `undefined` when the out point is unknown (an emergency track in the history).
 */
export function plannedLengthMs(
  inMs: number | undefined,
  outMs: number | undefined,
): number | undefined {
  return outMs === undefined ? undefined : Math.max(0, outMs - (inMs ?? 0));
}

/** `1:02.340`, `1:02:03.400` from one hour: the precision of a cue point. */
export function formatCueTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
  const millis = String(total % 1000).padStart(3, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}.${millis}`
    : `${minutes}:${seconds}.${millis}`;
}

/**
 * Reads `m:ss.SSS`, `h:mm:ss.SSS`, or plain seconds (`62.5`); the fraction is optional. Null for
 * anything else, so a form shows it as invalid instead of guessing.
 */
export function parseCueTime(text: string): number | null {
  const match = /^\s*(?:(?:(\d+):)?(\d+):)?(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!match) {
    return null;
  }
  const [, hours, minutes, seconds, fraction] = match;
  if ((minutes !== undefined && Number(seconds) >= 60) || (hours && Number(minutes) >= 60)) {
    return null;
  }
  const ms = fraction ? Number(fraction.padEnd(3, '0')) : 0;
  return (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds)) * 1000 + ms;
}

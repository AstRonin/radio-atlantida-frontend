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

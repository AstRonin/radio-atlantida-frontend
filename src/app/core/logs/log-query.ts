import type { ApiOperation } from '../api/api-client.service';

/** The query parameters of `GET /api/logs`, from the generated specification. */
export type LogsQueryParams = NonNullable<ApiOperation<'/api/logs', 'get'>['parameters']['query']>;
export type LogLevel = NonNullable<LogsQueryParams['level']>;
export type LogComponent = NonNullable<LogsQueryParams['component']>;

// Records keyed by the generated enums, so a value the backend adds is a compile error here.
const LEVELS: Record<LogLevel, true> = { DEBUG: true, INFO: true, WARN: true, ERROR: true };
const COMPONENTS: Record<LogComponent, true> = {
  api: true,
  db: true,
  rotation: true,
  liquidsoap: true,
  icecast: true,
  webrtc: true,
  retention: true,
  outage: true,
  reconcile: true,
  media: true,
};

export const LOG_LEVELS = Object.keys(LEVELS) as readonly LogLevel[];
export const LOG_COMPONENTS = Object.keys(COMPONENTS) as readonly LogComponent[];

export function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

export function isLogComponent(value: unknown): value is LogComponent {
  return LOG_COMPONENTS.includes(value as LogComponent);
}

/** The search text is 1 to 200 characters (the backend's `search` rule). */
export const LOG_SEARCH_MAX_LENGTH = 200;

/** The backend's request ID rule (`internal/logsearch`), so a bad ID is refused before sending. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9+/=._-]{1,200}$/;

/** The popup's link covers the alert's time this far before and after it. */
export const LOG_LINK_MARGIN_MS = 15 * 60 * 1000;

/** An instant as the API takes it: UTC with whole seconds, for example `2026-10-15T08:00:00Z`. */
export function apiInstant(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** An instant from a link, in the API's form; null when it is not a date. */
export function parseInstant(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : apiInstant(time);
}

/** Query parameters of the logs page that open the log around one event. */
export interface LogLinkParams {
  from: string;
  to: string;
  component?: LogComponent;
  request?: string;
}

/** The link of an error popup: the log from 15 minutes before the alert to 15 minutes after it. */
export function logLink(event: {
  time: string;
  component?: string;
  requestId?: string;
}): LogLinkParams {
  const at = new Date(event.time).getTime();
  return {
    from: apiInstant(at - LOG_LINK_MARGIN_MS),
    to: apiInstant(at + LOG_LINK_MARGIN_MS),
    ...(isLogComponent(event.component) ? { component: event.component } : {}),
    ...(event.requestId ? { request: event.requestId } : {}),
  };
}

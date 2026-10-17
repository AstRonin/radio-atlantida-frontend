import type { ApiOperation } from '../api/api-client.service';

export type LogQuery = NonNullable<
  ApiOperation<'/api/logs/files/{name}', 'get'>['parameters']['query']
>;
export type LogLevel = NonNullable<LogQuery['level']>;
export type LogComponent = NonNullable<LogQuery['component']>;

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

/** The backend writes one file per UTC date (design §10.1): `app-YYYY-MM-DD.log`. */
export function logFileName(utc: string): string {
  return `app-${new Date(utc).toISOString().slice(0, 10)}.log`;
}

/** Query parameters of the logs page that open the log of one event. */
export interface LogLinkParams {
  file: string;
  component?: LogComponent;
  request?: string;
}

export function logLink(event: {
  time: string;
  component?: string;
  requestId?: string;
}): LogLinkParams {
  return {
    file: logFileName(event.time),
    ...(isLogComponent(event.component) ? { component: event.component } : {}),
    ...(event.requestId ? { request: event.requestId } : {}),
  };
}

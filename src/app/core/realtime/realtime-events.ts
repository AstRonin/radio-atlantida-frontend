import type { ApiSchema } from '../api/api-types';

/** Any event the backend sends over `/api/ws` (design §6.5), generated from the `Event` schema. */
export type RealtimeEvent = ApiSchema<'Event'>;

export type RealtimeEventType = RealtimeEvent['type'];

/**
 * The event of one type. Operation events share a schema whose `type` is a union of every kind,
 * so the type is narrowed to the requested literal as well.
 */
export type RealtimeEventOf<T extends RealtimeEventType> = RealtimeEvent extends infer E
  ? E extends { type: infer U }
    ? T extends U
      ? Omit<E, 'type'> & { type: T }
      : never
    : never
  : never;

export type OperationCompletedEvent = ApiSchema<'OperationCompletedEvent'>;
export type OperationFailedEvent = ApiSchema<'OperationFailedEvent'>;
export type OperationProgressEvent = ApiSchema<'OperationProgressEvent'>;
export type OperationEvent =
  OperationCompletedEvent | OperationFailedEvent | OperationProgressEvent;

/**
 * Every event type of the contract. Typed as an exhaustive record, so an event type added to the
 * backend's `Event` schema is a compile error here until the panel knows it.
 */
const EVENT_TYPES: Readonly<Record<RealtimeEventType, true>> = {
  'error.alert': true,
  'broadcast_outage.started': true,
  'broadcast_outage.ended': true,
  'icecast.state': true,
  'broadcast.state': true,
  'liquidsoap.state': true,
  'live.state': true,
  'playout.now_playing': true,
  'track_plan.warning': true,
  'filler_request.created': true,
  'retention.completed': true,
  'retention.failed': true,
  'retention.progress': true,
  'track_plan.completed': true,
  'track_plan.failed': true,
  'track_plan.progress': true,
  'clock_build.completed': true,
  'clock_build.failed': true,
  'clock_build.progress': true,
  'missed_items.completed': true,
  'missed_items.failed': true,
  'missed_items.progress': true,
  'playout_reconcile.completed': true,
  'playout_reconcile.failed': true,
  'playout_reconcile.progress': true,
  'reschedule.completed': true,
  'reschedule.failed': true,
  'reschedule.progress': true,
  'import.completed': true,
  'import.failed': true,
  'import.progress': true,
  'analyse.completed': true,
  'analyse.failed': true,
  'analyse.progress': true,
  'transcode.completed': true,
  'transcode.failed': true,
  'transcode.progress': true,
};

export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return Object.hasOwn(EVENT_TYPES, value);
}

/**
 * Reads one WebSocket message. Returns null for anything that is not a known event envelope: an
 * event type this build does not know yet is skipped, so a newer backend cannot break the panel.
 * The payload itself is trusted to match the contract, like an HTTP response body.
 */
export function parseRealtimeEvent(message: unknown): RealtimeEvent | null {
  if (typeof message !== 'string') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value['type'] !== 'string' ||
    !isRealtimeEventType(value['type']) ||
    typeof value['time'] !== 'string' ||
    !isRecord(value['data'])
  ) {
    return null;
  }
  return value as unknown as RealtimeEvent;
}

export function isOperationEvent(event: RealtimeEvent): event is OperationEvent {
  return 'operation_id' in event;
}

export function isOperationCompleted(event: OperationEvent): event is OperationCompletedEvent {
  return event.type.endsWith('.completed');
}

export function isOperationFailed(event: OperationEvent): event is OperationFailedEvent {
  return event.type.endsWith('.failed');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

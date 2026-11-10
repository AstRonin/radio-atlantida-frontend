import type { ApiSchema } from '../../core/api/api-types';

type TrackPlanItem = ApiSchema<'TrackPlanItem'>;
type TrackPlanInsert = ApiSchema<'TrackPlanInsert'>;

const HOUR_MS = 3_600_000;

/** How a row is moved: a fill or rule row becomes a pin, a one-time insert with a fixed time moves. */
export type PlanMoveTarget =
  { kind: 'pin'; planItemId: number } | { kind: 'insert'; insertId: number };

/**
 * What moving this row means, or null when it cannot move. Only the rows the backend accepts have
 * a target; the backend still decides, because the plan may have changed since it was read.
 */
export function moveTargetOf(
  item: TrackPlanItem,
  inserts: readonly TrackPlanInsert[],
  frozen: boolean,
): PlanMoveTarget | null {
  if (frozen || item.status !== 'planned') {
    return null;
  }
  if (item.source === 'fill' || item.source === 'rule') {
    return { kind: 'pin', planItemId: item.id };
  }
  if (item.source !== 'hour_insert' && item.source !== 'reschedule') {
    return null;
  }
  const insert = inserts.find((candidate) => candidate.id === item.hour_insert_id);
  return insert?.placement === 'fixed' ? { kind: 'insert', insertId: insert.id } : null;
}

/**
 * The new start of the row at `from` when it lands on the row at `to`, from the hour start, in the
 * whole seconds the API takes: the start of that row when moving up, its end when moving down. A
 * track moved down that would not end by 60:00 starts so that it is the last of the hour.
 */
export function moveOffsetMs(
  hourStartUtc: string,
  items: readonly TrackPlanItem[],
  from: number,
  to: number,
): number {
  const landed = items[to];
  const start = Date.parse(landed.planned_start_utc) - Date.parse(hourStartUtc);
  if (to < from) {
    return Math.max(Math.round(start / 1000) * 1000, 0);
  }
  const offset = Math.round((start + landed.planned_out_ms - landed.planned_in_ms) / 1000) * 1000;
  const length = wholeLengthMs(items[from]);
  return offset + length <= HOUR_MS
    ? offset
    : Math.max(Math.floor((HOUR_MS - length) / 1000) * 1000, 0);
}

// The backend places a moved track whole, so a track cut in this build counts with its cut part.
function wholeLengthMs(item: TrackPlanItem): number {
  return item.truncated
    ? item.duration_ms - item.planned_in_ms
    : item.planned_out_ms - item.planned_in_ms;
}

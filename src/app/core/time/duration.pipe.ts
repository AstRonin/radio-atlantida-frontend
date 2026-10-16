import { Pipe, PipeTransform } from '@angular/core';
import { formatDurationMs, plannedLengthMs } from './duration';

/** `{{ track.duration_ms | duration }}` -> `3:45`. An unknown duration is shown as a dash. */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(ms: number | null | undefined): string {
    return ms === null || ms === undefined ? '—' : formatDurationMs(ms);
  }
}

/**
 * `{{ item.planned_out_ms | plannedLength: item.planned_in_ms }}` -> `3:41`: the length between the
 * in and out points, never the out point alone. An unknown out point is shown as a dash.
 */
@Pipe({ name: 'plannedLength' })
export class PlannedLengthPipe implements PipeTransform {
  transform(outMs: number | null | undefined, inMs: number | null | undefined): string {
    const length = plannedLengthMs(inMs ?? undefined, outMs ?? undefined);
    return length === undefined ? '—' : formatDurationMs(length);
  }
}

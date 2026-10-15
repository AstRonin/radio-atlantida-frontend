import { Pipe, PipeTransform } from '@angular/core';
import { formatDurationMs } from './duration';

/** `{{ track.duration_ms | duration }}` -> `3:45`. An unknown duration is shown as a dash. */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(ms: number | null | undefined): string {
    return ms === null || ms === undefined ? '—' : formatDurationMs(ms);
  }
}

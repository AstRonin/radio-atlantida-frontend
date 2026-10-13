import { Pipe, PipeTransform, inject } from '@angular/core';
import { StationTimeService, TimeFormat } from './station-time.service';

/**
 * `{{ track.created_at | stationTime }}`: an API timestamp in the station timezone.
 * Impure because the zone and the language are signals that change without the input changing;
 * the formatters are cached, so a call is cheap.
 */
@Pipe({ name: 'stationTime', pure: false })
export class StationTimePipe implements PipeTransform {
  private readonly time = inject(StationTimeService);

  transform(value: string | null | undefined, format: TimeFormat = 'datetime'): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    try {
      return this.time.format(value, format);
    } catch {
      // A malformed value is a backend bug; showing it raw keeps the rest of the view usable.
      return value;
    }
  }
}

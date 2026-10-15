import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ApiSchema } from '../api/api-types';
import { RealtimeService } from '../realtime/realtime.service';
import { parseApiTime } from '../time/station-time.service';

export type TrackPlanWarning = ApiSchema<'TrackPlanWarning'>;

interface HourWarnings {
  /** UTC; when the build that found the warnings finished. */
  time: number;
  warnings: readonly TrackPlanWarning[];
}

/** Hours whose warnings are kept; the plan covers at most 48 hours, so this is ample. */
export const PLAN_WARNING_HOURS_KEPT = 500;

/**
 * Warnings of the built hours of the track plan (design §7, backend phase-8 plan §2 item 11). The
 * plan API does not return them: the engine sends `track_plan.warning` once per built hour that
 * has warnings, so only builds since the panel was opened are known. A later build of an hour
 * without warnings sends nothing; `forHour()` therefore compares the event time with the hour's
 * `built_at` and drops warnings of an older build.
 */
@Injectable({ providedIn: 'root' })
export class PlanWarningsService {
  private readonly byHour = signal<ReadonlyMap<number, HourWarnings>>(new Map());

  constructor() {
    inject(RealtimeService)
      .on('track_plan.warning')
      .pipe(takeUntilDestroyed())
      .subscribe(({ time, data }) => this.add(data.hour_start_utc, time, data.warnings));
  }

  /**
   * The warnings of the hour's current build: an empty list when none are known for it, or when
   * they belong to a build older than `builtAt`. Reads a signal, so a view's `computed` updates
   * when an event arrives.
   */
  forHour(hourStartUtc: string, builtAt: string): readonly TrackPlanWarning[] {
    const entry = this.byHour().get(parseApiTime(hourStartUtc).getTime());
    if (!entry || entry.time < parseApiTime(builtAt).getTime()) {
      return [];
    }
    return entry.warnings;
  }

  private add(hourStartUtc: string, time: string, warnings: readonly TrackPlanWarning[]): void {
    const hour = parseApiTime(hourStartUtc).getTime();
    const at = parseApiTime(time).getTime();
    this.byHour.update((current) => {
      const previous = current.get(hour);
      if (previous && previous.time > at) {
        return current;
      }
      const next = new Map(current).set(hour, { time: at, warnings });
      // Drop the earliest hours; they are in the past long before the limit is reached.
      for (const old of [...next.keys()].sort((a, b) => a - b)) {
        if (next.size <= PLAN_WARNING_HOURS_KEPT) {
          break;
        }
        next.delete(old);
      }
      return next;
    });
  }
}

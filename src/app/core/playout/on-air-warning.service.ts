import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, merge, switchMap, tap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import type { ApiSchema } from '../api/api-types';
import { RealtimeService } from '../realtime/realtime.service';

type PlayoutStatus = ApiSchema<'PlayoutStatus'>;

export type OnAirWarning = { kind: 'safety' } | { kind: 'emergency'; title: string };

/**
 * What the header warns about: the safety tone or an emergency track on air (design §8.6). The
 * state is read each time the event connection opens and then follows the playout events. When an
 * emergency track ends, the status is read again instead of guessing what comes next.
 */
@Injectable({ providedIn: 'root' })
export class OnAirWarningService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly safetyOnAir = signal(false);
  private readonly emergencyTitle = signal<string | null>(null);
  private readonly refetch = new Subject<void>();
  // Counted per fact, so a status answer that an event has overtaken does not undo that event but
  // still updates the other fact.
  private safetyEvents = 0;
  private trackEvents = 0;

  /** The tone comes first: with it on air, nothing else is playing. */
  readonly warning = computed((): OnAirWarning | null => {
    if (this.safetyOnAir()) {
      return { kind: 'safety' };
    }
    const title = this.emergencyTitle();
    return title === null ? null : { kind: 'emergency', title };
  });

  constructor() {
    this.realtime
      .on('playout.now_playing')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.trackEvents++;
        this.showTrack(data);
      });
    this.realtime
      .on('playout.track_ended')
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.emergencyTitle() !== null) {
          this.refetch.next();
        }
      });
    this.realtime
      .on('playout.safety')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.safetyEvents++;
        this.safetyOnAir.set(data.on_air);
      });
    merge(this.realtime.connected$, this.refetch)
      .pipe(
        switchMap(() => this.readStatus()),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private readStatus(): Observable<PlayoutStatus> {
    const safetyEvents = this.safetyEvents;
    const trackEvents = this.trackEvents;
    return this.api.get('/api/playout/status').pipe(
      tap((status) => {
        if (safetyEvents === this.safetyEvents) {
          // A backend older than this field omits it, whatever the contract says: not on air.
          this.safetyOnAir.set(status.safety_on_air === true);
        }
        if (trackEvents === this.trackEvents) {
          this.showTrack(status.now_playing);
        }
      }),
      catchError((error: unknown) => {
        console.error('Could not read the playout status.', error);
        return EMPTY;
      }),
    );
  }

  private showTrack(track: PlayoutStatus['now_playing']): void {
    this.emergencyTitle.set(track?.source === 'emergency' ? track.title : null);
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import type { ApiSchema } from '../api/api-types';
import { RealtimeService } from '../realtime/realtime.service';

export type BroadcastState = ApiSchema<'BroadcastStatus'>['state'];

/** The broadcast state without the server time of the answer that carried it. */
export type BroadcastStatus = ApiSchema<'BroadcastStateData'>;

export const UNKNOWN_BROADCAST: BroadcastStatus = {
  state: 'unknown',
  since: null,
  mount_ok: null,
  last_check_at: null,
};

/**
 * Whether the stream reaches Icecast, and since when (backend phase 16). The state changes on
 * `broadcast.state`; each time the event connection opens it is read once, as `OutageService`
 * does, so a reloaded panel shows the stored `since` instead of starting from zero.
 *
 * Every answer carries the server's time, kept as an offset to the browser clock, so the header
 * timer counts the right duration on a browser whose clock is wrong.
 */
@Injectable({ providedIn: 'root' })
export class BroadcastService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly current = signal<BroadcastStatus>(UNKNOWN_BROADCAST);
  private readonly offset = signal(0);
  // Counts state events, so a sync answer that an event has overtaken is not applied.
  private eventCount = 0;

  readonly status = this.current.asReadonly();
  /** Server time minus browser time, in milliseconds. */
  readonly clockOffsetMs = this.offset.asReadonly();

  constructor() {
    this.realtime
      .on('broadcast.state')
      .pipe(takeUntilDestroyed())
      .subscribe(({ time, data }) => {
        this.eventCount++;
        this.syncClock(time);
        this.current.set(data);
      });
    this.realtime.connected$
      .pipe(
        switchMap(() => {
          const before = this.eventCount;
          return this.api.get('/api/broadcast/status').pipe(
            catchError((error: unknown) => {
              console.error('Could not read the broadcast status.', error);
              return EMPTY;
            }),
            switchMap((answer) => (this.eventCount === before ? [answer] : EMPTY)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ time, ...status }) => {
        this.syncClock(time);
        this.current.set(status);
      });
  }

  /** The server's current time, in milliseconds since the epoch. */
  serverNow(): number {
    return Date.now() + this.offset();
  }

  private syncClock(serverTime: string): void {
    const server = Date.parse(serverTime);
    if (Number.isFinite(server)) {
      this.offset.set(server - Date.now());
    }
  }
}

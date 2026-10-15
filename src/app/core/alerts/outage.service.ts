import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import type { ApiSchema } from '../api/api-types';
import { RealtimeService } from '../realtime/realtime.service';

export type OutageComponent = ApiSchema<'OutageStartedData'>['component'];

export interface OpenOutage {
  id: number;
  /** UTC instant. */
  startedAt: string;
  component: OutageComponent;
  reason?: string;
}

/** `GET /api/outages` window around "now", wide enough for a browser clock that is off. */
export const OUTAGE_SYNC_WINDOW_MS = 60 * 60_000;

/**
 * The open broadcast outage, shown as a persistent banner (design §7.1, §10.1). It opens on
 * `broadcast_outage.started` and closes only on `broadcast_outage.ended`; the operator cannot
 * dismiss it. Each time the event connection opens, the stored state is read once, so a panel
 * opened during an outage, or one that missed the events while disconnected, shows the truth.
 */
@Injectable({ providedIn: 'root' })
export class OutageService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly current = signal<OpenOutage | null>(null);
  // Counts outage events, so a sync answer that an event has overtaken is not applied.
  private eventCount = 0;

  readonly openOutage = this.current.asReadonly();

  constructor() {
    this.realtime
      .on('broadcast_outage.started')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.eventCount++;
        this.current.set({
          id: data.outage_id,
          startedAt: data.started_at,
          component: data.component,
          reason: data.reason,
        });
      });
    this.realtime
      .on('broadcast_outage.ended')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.eventCount++;
        if (this.current()?.id === data.outage_id) {
          this.current.set(null);
        }
      });
    this.realtime.connected$
      .pipe(
        switchMap(() => {
          const before = this.eventCount;
          const now = Date.now();
          return this.api
            .get('/api/outages', {
              query: {
                from: new Date(now - OUTAGE_SYNC_WINDOW_MS).toISOString(),
                to: new Date(now + OUTAGE_SYNC_WINDOW_MS).toISOString(),
              },
            })
            .pipe(
              catchError((error: unknown) => {
                console.error('Could not read the open outage.', error);
                return EMPTY;
              }),
              switchMap((list) => (this.eventCount === before ? [list] : EMPTY)),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        const open = (list.items ?? []).find((outage) => !outage.ended_at);
        this.current.set(
          open
            ? {
                id: open.id,
                startedAt: open.started_at,
                component: open.component,
                reason: open.reason,
              }
            : null,
        );
      });
  }
}

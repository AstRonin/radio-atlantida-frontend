import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, map, merge, share, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * The number of open missed items (design §7.1): items an outage kept off the air that wait for the
 * manager to reschedule or dismiss them. Shown in the header, because they are kept until resolved.
 * The panel does not poll: the count is read when the event connection opens and whenever items may
 * have been marked or resolved — the marking after an outage, the reconciliation after backend
 * downtime, a completed reschedule, or a dismiss from the panel (`refresh()`).
 */
@Injectable({ providedIn: 'root' })
export class MissedItemsService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly refreshes = new Subject<void>();
  private readonly count = signal<number | null>(null);

  /** Open missed items; null until the first read succeeds. */
  readonly open = this.count.asReadonly();

  /** Emits whenever missed items may have changed, so the pages reload their lists. */
  readonly changes$: Observable<void> = merge(
    this.realtime.connected$,
    this.realtime.on('missed_items.completed'),
    this.realtime.on('playout_reconcile.completed'),
    this.realtime.on('reschedule.completed'),
    this.refreshes,
  ).pipe(
    map(() => undefined),
    share(),
  );

  constructor() {
    this.changes$
      .pipe(
        switchMap(() =>
          this.api.get('/api/missed-items', { query: { resolution: 'open' } }).pipe(
            catchError((error: unknown) => {
              // The next trigger reads again; until then the header keeps the last count.
              console.error('Could not read the missed items.', error);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.count.set(list.items?.length ?? 0));
  }

  /** Reads the count again, for example after the panel dismissed an item. */
  refresh(): void {
    this.refreshes.next();
  }
}

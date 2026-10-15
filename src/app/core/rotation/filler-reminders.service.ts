import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, map, merge, share, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * The number of filler reminders that wait for the operator (design §7, "Filler reminders"),
 * shown in the header so a new one is not missed. The panel does not poll: the count is read when
 * the event connection opens and whenever something may have opened or closed a reminder — a new
 * reminder, a plan job (it defaults reminders whose deadline passed), a rebuild (it expires the
 * pending reminders of its hours), or an answer from the panel (`refresh()`).
 */
@Injectable({ providedIn: 'root' })
export class FillerRemindersService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly refreshes = new Subject<void>();
  private readonly count = signal<number | null>(null);

  /** Pending reminders; null until the first read succeeds. */
  readonly pending = this.count.asReadonly();

  /** Emits whenever reminders may have changed, so the reminders page reloads its list. */
  readonly changes$: Observable<void> = merge(
    this.realtime.connected$,
    this.realtime.on('filler_request.created'),
    this.realtime.on('track_plan.completed'),
    this.realtime.on('clock_build.completed'),
    this.refreshes,
  ).pipe(
    map(() => undefined),
    share(),
  );

  constructor() {
    this.changes$
      .pipe(
        switchMap(() =>
          this.api.get('/api/filler-requests', { query: { status: 'pending' } }).pipe(
            catchError((error: unknown) => {
              // The next trigger reads again; until then the header keeps the last count.
              console.error('Could not read the filler reminders.', error);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => this.count.set(list.items.length));
  }

  /** Reads the count again, for example after the panel answered a reminder. */
  refresh(): void {
    this.refreshes.next();
  }
}

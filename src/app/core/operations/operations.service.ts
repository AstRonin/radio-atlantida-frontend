import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  expand,
  filter,
  map,
  merge,
  of,
  switchMap,
  take,
  timer,
} from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import type { ApiSchema } from '../api/api-types';
import {
  OperationEvent,
  isOperationCompleted,
  isOperationEvent,
  isOperationFailed,
} from '../realtime/realtime-events';
import { RealtimeConnection, RealtimeService } from '../realtime/realtime.service';

export type OperationDto = ApiSchema<'Operation'>;

/** `accepted`: the start request returned its ID, and nothing else is known yet. */
export type OperationStatus = 'accepted' | OperationDto['status'];

export interface OperationProgress {
  done: number;
  /** 0 when unknown. */
  total: number;
  message?: string;
}

export interface OperationState {
  id: number;
  /** Null while only the ID is known. */
  kind: string | null;
  status: OperationStatus;
  /** UTC; the last time the panel learned something about the operation. */
  updatedAt: string | null;
  summary?: string;
  error?: string;
  component?: string;
  progress?: OperationProgress;
}

/**
 * The operation kinds the backend's ingest worker runs one at a time (`internal/ingest`). A replace
 * is refused with `media_operation_running` while any of them runs, whoever started it. Clock,
 * rotation, and hour-insert builds are not media operations.
 */
export const MEDIA_OPERATION_KINDS: ReadonlySet<string> = new Set([
  'import',
  'analyse',
  'transcode',
]);

/** Wait this long for the terminal event before reading the stored outcome once. */
export const OPERATION_FALLBACK_MS = 30_000;
/** Operations the store keeps for the header list; older ones are dropped. */
export const OPERATIONS_KEPT = 50;
/** Page size of the catch-up request (the backend's maximum). */
export const CATCH_UP_PAGE = 500;
/** Covers a difference between the browser clock and the server clock. */
export const CATCH_UP_MARGIN_MS = 5 * 60_000;

export function isTerminal(state: OperationState): boolean {
  return state.status === 'completed' || state.status === 'failed';
}

/**
 * The state of asynchronous backend operations (design §6.5), from WebSocket events. Events missed
 * while the socket was down are read from `GET /api/operations?since=` on reconnect; the
 * `operations` table is the source of truth.
 *
 * A failed operation is not shown as a popup here: the backend logs the failure at ERROR, which
 * already arrives as an `error.alert` (see AlertsService).
 */
@Injectable({ providedIn: 'root' })
export class OperationsService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly states = signal<ReadonlyMap<number, OperationState>>(new Map());
  private readonly terminalSubject = new Subject<OperationState>();

  /** Known operations, newest first. */
  readonly operations = computed(() => [...this.states().values()].sort((a, b) => b.id - a.id));
  readonly activeCount = computed(
    () => this.operations().filter((operation) => !isTerminal(operation)).length,
  );
  /** True while an import, analysis, or transcode runs, whoever started it. */
  readonly mediaOperationRunning = computed(() =>
    this.operations().some(
      (operation) =>
        !isTerminal(operation) &&
        operation.kind !== null &&
        MEDIA_OPERATION_KINDS.has(operation.kind),
    ),
  );
  /** Emits once per operation when it completes or fails. */
  readonly terminal$: Observable<OperationState> = this.terminalSubject.asObservable();

  constructor() {
    this.realtime.events$
      .pipe(filter(isOperationEvent), takeUntilDestroyed())
      .subscribe((event) => this.applyEvent(event));
    this.realtime.connected$
      .pipe(
        filter((connection) => connection.reconnect),
        switchMap((connection) => this.catchUp(connection)),
        takeUntilDestroyed(),
      )
      .subscribe((operation) => this.applyDto(operation));
  }

  get(id: number): OperationState | undefined {
    return this.states().get(id);
  }

  /**
   * Starts an operation and emits its terminal state (completed or failed), then completes.
   * `start` is the request that returns `{ operation_id }`. If no terminal event arrives in
   * time, the stored outcome is read once; a still-running operation keeps waiting for its event.
   * Unsubscribing stops the wait, not the operation.
   */
  runOperation(
    start: Observable<{ operation_id: number }>,
    fallbackAfterMs = OPERATION_FALLBACK_MS,
  ): Observable<OperationState> {
    return start.pipe(switchMap(({ operation_id }) => this.waitFor(operation_id, fallbackAfterMs)));
  }

  /** Emits the terminal state of an operation that is already running, for example a clock build. */
  waitFor(id: number, fallbackAfterMs = OPERATION_FALLBACK_MS): Observable<OperationState> {
    return defer(() => {
      const known = this.track(id);
      if (isTerminal(known)) {
        return of(known);
      }
      const event = this.terminal$.pipe(filter((state) => state.id === id));
      const fallback = timer(fallbackAfterMs).pipe(
        switchMap(() => this.api.get('/api/operations/{id}', { path: { id } })),
        // A failed read changes nothing: the event or the catch-up after a reconnect still arrive.
        catchError(() => EMPTY),
        map((operation) => this.applyDto(operation)),
        filter(isTerminal),
      );
      return merge(event, fallback).pipe(take(1));
    });
  }

  /** Records an operation the panel started, so it appears before its first event. */
  private track(id: number): OperationState {
    const known = this.get(id);
    if (known) {
      return known;
    }
    const state: OperationState = { id, kind: null, status: 'accepted', updatedAt: null };
    this.store(state);
    return state;
  }

  private applyEvent(event: OperationEvent): void {
    const previous = this.get(event.operation_id);
    const base: OperationState = previous ?? {
      id: event.operation_id,
      kind: event.data.kind,
      status: 'running',
      updatedAt: null,
    };
    if (isTerminal(base)) {
      // Events can overtake each other only across a reconnect; a terminal state is final.
      return;
    }
    const next: OperationState = { ...base, kind: event.data.kind, updatedAt: event.time };
    if (isOperationCompleted(event)) {
      this.update({ ...next, status: 'completed', summary: event.data.summary });
    } else if (isOperationFailed(event)) {
      this.update({
        ...next,
        status: 'failed',
        error: event.data.error,
        component: event.data.component,
      });
    } else {
      this.update({
        ...next,
        status: 'running',
        progress: {
          done: event.data.done,
          total: event.data.total,
          message: event.data.message,
        },
      });
    }
  }

  private applyDto(operation: OperationDto): OperationState {
    const previous = this.get(operation.id);
    if (previous && isTerminal(previous)) {
      return previous;
    }
    const next: OperationState = {
      ...previous,
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      updatedAt: operation.finished_at ?? operation.started_at,
      summary: operation.result_summary,
      error: operation.error_message,
    };
    // The progress the operation stored; a DTO without it keeps the progress already known.
    if (operation.progress_done !== undefined) {
      const message = previous?.progress?.message;
      next.progress = {
        done: operation.progress_done,
        total: operation.progress_total ?? 0,
        ...(message === undefined ? {} : { message }),
      };
    }
    this.update(next);
    return next;
  }

  private update(next: OperationState): void {
    const previous = this.get(next.id);
    this.store(next);
    if (isTerminal(next) && !(previous && isTerminal(previous))) {
      this.terminalSubject.next(next);
    }
  }

  private store(state: OperationState): void {
    this.states.update((states) => {
      const next = new Map(states).set(state.id, state);
      // Drop the oldest finished operations; one still awaited is kept.
      const removable = [...next.values()]
        .filter(isTerminal)
        .sort((a, b) => a.id - b.id)
        .slice(0, Math.max(0, next.size - OPERATIONS_KEPT));
      for (const old of removable) {
        next.delete(old.id);
      }
      return next;
    });
  }

  /** Every operation that started or finished while the socket was down, page by page. */
  private catchUp(connection: RealtimeConnection): Observable<OperationDto> {
    const downSince = connection.downSince ?? new Date();
    const since = new Date(downSince.getTime() - CATCH_UP_MARGIN_MS).toISOString();
    const page = (afterId?: number) =>
      this.api.get('/api/operations', {
        query: { since, after_id: afterId, limit: CATCH_UP_PAGE },
      });

    return page().pipe(
      expand((list) => {
        const last = list.items.at(-1);
        return list.items.length === CATCH_UP_PAGE && last ? page(last.id) : EMPTY;
      }),
      switchMap((list) => list.items),
      catchError((error: unknown) => {
        // The next reconnect tries again; until then the store keeps what it has.
        console.error('Could not catch up on operations.', error);
        return EMPTY;
      }),
    );
  }
}

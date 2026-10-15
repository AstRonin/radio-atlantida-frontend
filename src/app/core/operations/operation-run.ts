import { Signal, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { OperationState, OperationsService, isTerminal } from './operations.service';

/** The operation a page started last, followed live for its status line. */
export interface OperationRun {
  /** Its current state (progress, summary), or null before the first start. */
  readonly state: Signal<OperationState | null>;
  /** True from the start request until the terminal state, or until the request fails. */
  readonly running: Signal<boolean>;
  /** Like `OperationsService.runOperation()`, and remembers the operation for `state`. */
  run(start: Observable<{ operation_id: number }>): Observable<OperationState>;
  /** Forgets the last operation, which hides its status line. */
  clear(): void;
}

/**
 * Follows the operations a page starts, one at a time: `runOperation()` emits only the terminal
 * state, while a status line also needs the progress events in between, which the operations
 * store already holds. Call in an injection context.
 */
export function followOperation(): OperationRun {
  const operations = inject(OperationsService);
  const id = signal<number | null>(null);
  const starting = signal(false);

  const state = computed(() => {
    const current = id();
    return current === null
      ? null
      : (operations.operations().find((operation) => operation.id === current) ?? null);
  });
  const running = computed(() => {
    const current = state();
    return starting() || (current !== null && !isTerminal(current));
  });

  return {
    state,
    running,
    run: (start) => {
      id.set(null);
      starting.set(true);
      return operations.runOperation(
        start.pipe(
          tap({
            next: ({ operation_id }) => {
              id.set(operation_id);
              starting.set(false);
            },
            error: () => starting.set(false),
            // Unsubscribed before the start request answered.
            finalize: () => starting.set(false),
          }),
        ),
      );
    },
    clear: () => {
      id.set(null);
      starting.set(false);
    },
  };
}

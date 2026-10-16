import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiClient } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';

/** `DeleteTracksBody.track_ids` limit. */
export const BULK_DELETE_MAX = 1000;

export type TrackRefusal = ApiSchema<'TrackRefusal'>;

export interface BulkDeleteResult extends ApiSchema<'DeleteTracksResult'> {
  /** How many tracks the request named. */
  requested: number;
}

/**
 * Deletes several library tracks with one `POST /api/tracks/delete` (docs/f17-bulk-delete-plan.md).
 * `done` runs after the response with the deleted IDs, and after a failure with none: a 500 may
 * still have deleted some tracks, so the caller reads the list again either way. Leaving the page
 * cancels the request; the backend still finishes it. Call in an injection context.
 */
export function trackBulkDelete(done: (deleted: readonly number[]) => void) {
  const api = inject(ApiClient);
  const i18n = inject(I18nService);
  const destroyRef = inject(DestroyRef);
  const count = signal<number | null>(null);
  const result = signal<BulkDeleteResult | null>(null);
  const error = signal<string | null>(null);

  return {
    /** The number of tracks being deleted, while the request runs. */
    count: count.asReadonly(),
    running: computed(() => count() !== null),
    result: result.asReadonly(),
    error: error.asReadonly(),
    start(trackIds: readonly number[]): void {
      result.set(null);
      error.set(null);
      count.set(trackIds.length);
      api
        .post('/api/tracks/delete', { body: { track_ids: [...trackIds] } })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (response) => {
            count.set(null);
            result.set({ ...response, requested: trackIds.length });
            done(response.deleted);
          },
          error: (cause: unknown) => {
            count.set(null);
            // The generic internal error text hides how many tracks went before the failure.
            const detail =
              cause instanceof ApiProblem && cause.status === 500 ? cause.detail : undefined;
            const message = errorMessage(cause, i18n);
            error.set(detail ? `${message} (${detail})` : message);
            done([]);
          },
        });
    },
    clear(): void {
      result.set(null);
      error.set(null);
    },
  };
}

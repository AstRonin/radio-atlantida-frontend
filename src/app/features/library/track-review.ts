import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';

/** `ReviewTracksBody.track_ids` limit, the same as a bulk delete. */
export const BULK_REVIEW_MAX = 1000;

export interface ReviewResult extends ApiSchema<'ReviewTracksResult'> {
  reviewed: boolean;
}

/**
 * Sets or clears the reviewed mark of several tracks with one `POST /api/tracks/review`
 * (docs/f19-track-titles-review-weekdays-plan.md §4.2). `done` runs after the response with the
 * IDs that no longer exist, and after a failure with none; the caller reads the list again either
 * way. Leaving the page cancels the request. Call in an injection context.
 */
export function trackReview(done: (notFound: readonly number[]) => void) {
  const api = inject(ApiClient);
  const i18n = inject(I18nService);
  const destroyRef = inject(DestroyRef);
  const running = signal(false);
  const result = signal<ReviewResult | null>(null);
  const error = signal<string | null>(null);

  return {
    running: running.asReadonly(),
    result: result.asReadonly(),
    error: error.asReadonly(),
    /** A short line for the selection bar, when tracks were not found. */
    notFound: computed(() => result()?.not_found.length ?? 0),
    start(trackIds: readonly number[], reviewed: boolean): void {
      result.set(null);
      error.set(null);
      running.set(true);
      api
        .post('/api/tracks/review', { body: { track_ids: [...trackIds], reviewed } })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (response) => {
            running.set(false);
            result.set({ ...response, reviewed });
            done(response.not_found);
          },
          error: (cause: unknown) => {
            running.set(false);
            error.set(errorMessage(cause, i18n));
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

import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, filter, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { followOperation } from '../../core/operations/operation-run';
import type { OperationState } from '../../core/operations/operations.service';
import { ConfirmService } from '../../shared/ui/confirm.service';

export type TrackFix = ApiSchema<'TranscodeBody'>['fix'];
export type TranscodeOutput = ApiSchema<'TranscodeBody'>['output'];

/** `AnalyseBody` and `TranscodeBody` limits. */
export const MEDIA_LIMITS = { analyseMax: 1000, transcodeMax: 200 } as const;

export type MediaRequest =
  | ({ kind: 'analyse' } & ApiSchema<'AnalyseBody'>)
  | ({ kind: 'transcode' } & ApiSchema<'TranscodeBody'>);

/**
 * Starts an analysis or a transcode of library tracks and follows it. Replacing original files
 * asks first. `done` runs when the operation ends either way, since a failed batch may still have
 * changed some tracks. Call in an injection context.
 */
export function trackMedia(done: (state: OperationState) => void) {
  const api = inject(ApiClient);
  const confirm = inject(ConfirmService);
  const i18n = inject(I18nService);
  const destroyRef = inject(DestroyRef);
  const run = followOperation();
  const error = signal<string | null>(null);

  const startRequest = (request: MediaRequest): Observable<{ operation_id: number }> => {
    if (request.kind === 'analyse') {
      return api.post('/api/tracks/analyse', {
        body: { track_ids: request.track_ids, force: request.force },
      });
    }
    return api.post('/api/tracks/transcode', {
      body: { track_ids: request.track_ids, fix: request.fix, output: request.output },
    });
  };

  return {
    run,
    error: error.asReadonly(),
    /** Tracks whose start and stop points the new file reset, from the summary. */
    cueReset: computed(() => cueResetNote(run.state()?.summary)),
    start(request: MediaRequest): void {
      error.set(null);
      // The request is sent after the dialog closes, because the page follows its operation ID.
      const confirmed =
        request.kind === 'transcode' && request.output === 'replace'
          ? confirm.confirm({
              title: 'library.media.replaceDialog.title',
              message: 'library.media.replaceDialog.message',
              params: { count: request.track_ids.length },
              confirmLabel: 'library.media.replaceDialog.confirm',
              destructive: true,
            })
          : of(true);
      confirmed
        .pipe(
          filter(Boolean),
          switchMap(() => run.run(startRequest(request))),
          takeUntilDestroyed(destroyRef),
        )
        .subscribe({
          next: done,
          // A failed operation is already an error.alert popup; this is a refused start.
          error: (cause: unknown) => error.set(errorMessage(cause, i18n)),
        });
    },
  };
}

export interface CueResetNote {
  count: number;
  /** At most five paths, as the backend lists them. */
  paths: string;
}

/**
 * Reads `cue_reset N: [paths]` from the summary of an analysis or a transcode (backend phase 22
 * §10): a new file that is shorter than a track's stop point resets its cue.
 */
export function cueResetNote(summary: string | undefined): CueResetNote | null {
  const match = summary ? /cue_reset (\d+): \[([^\]]*)\]/.exec(summary) : null;
  return match ? { count: Number(match[1]), paths: match[2] } : null;
}

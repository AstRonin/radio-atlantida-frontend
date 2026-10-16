import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { notBlankValidator } from '../../shared/forms/validators';
import type { Track } from './track-form';

/** `RenameTracksBody` limits. */
export const BULK_RENAME_MAX = 1000;
export const RENAME_TEXT_MAX = 200;

export type RenameResult = ApiSchema<'RenameTracksResult'>;

export interface TrackBulkRenameDialogData {
  tracks: readonly Track[];
}

/** Closes with the IDs that no longer exist after an apply; `undefined` when nothing was written. */
export interface TrackBulkRenameDialogResult {
  notFound: readonly number[];
}

/**
 * Find and replace in the titles of the selected tracks (docs/f19-track-titles-review-weekdays-plan.md
 * §4.1). The preview is the backend's `dry_run` answer; any change of the fields drops it, so
 * Apply always writes what the manager last saw. The answer of the apply is shown, since a title
 * may have changed in between.
 */
@Component({
  selector: 'app-track-bulk-rename-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    TranslatePipe,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      {{ 'library.bulkRename.title' | translate: { count: tracks.length } }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="preview()">
      <mat-dialog-content>
        @if (!applied()) {
          <app-text-input
            [control]="form.controls.find"
            label="library.bulkRename.find"
            [maxLength]="textMax"
            [spellcheck]="false"
          />
          <app-text-input
            [control]="form.controls.replace"
            label="library.bulkRename.replace"
            hint="library.bulkRename.replaceHint"
            [maxLength]="textMax"
            [spellcheck]="false"
          />
          <mat-checkbox [formControl]="form.controls.match_case">
            {{ 'library.bulkRename.matchCase' | translate }}
          </mat-checkbox>
        }
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
        }
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (result(); as answer) {
          <section class="result" role="status">
            <h3>
              {{
                (applied() ? 'library.bulkRename.appliedTitle' : 'library.bulkRename.previewTitle')
                  | translate: { count: answer.changed.length }
              }}
            </h3>
            @if (answer.changed.length > 0) {
              <ul class="changes">
                @for (change of answer.changed; track change.track_id) {
                  <li>
                    <span class="old">{{ change.old_title }}</span>
                    <span aria-hidden="true"> → </span>
                    <span class="cdk-visually-hidden">{{
                      'library.bulkRename.to' | translate
                    }}</span>
                    <span class="new">{{ change.new_title }}</span>
                  </li>
                }
              </ul>
            }
            <p class="muted">
              {{ 'library.bulkRename.unchanged' | translate: { count: answer.unchanged.length } }}
            </p>
            @if (answer.refused.length > 0) {
              <h3>
                {{
                  'library.bulkRename.refusedTitle' | translate: { count: answer.refused.length }
                }}
              </h3>
              <ul class="refused">
                @for (refusal of answer.refused; track refusal.track_id) {
                  <li>
                    <span class="old">{{ titleOf(refusal.track_id) }}</span
                    >:
                    {{ 'problems.' + refusal.code | translate }}
                  </li>
                }
              </ul>
            }
            @if (applied() && answer.changed.length > 0) {
              <p class="muted">{{ 'library.bulkRename.reviewNote' | translate }}</p>
            }
          </section>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        @if (applied()) {
          <button matButton="filled" type="button" (click)="close()">
            {{ 'common.close' | translate }}
          </button>
        } @else {
          <button matButton type="button" [mat-dialog-close]="undefined">
            {{ 'common.cancel' | translate }}
          </button>
          <button matButton type="submit" [disabled]="busy() || form.invalid">
            {{ 'library.bulkRename.preview' | translate }}
          </button>
          <button matButton="filled" type="button" [disabled]="!canApply()" (click)="apply()">
            {{ 'library.bulkRename.apply' | translate }}
          </button>
        }
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .result h3 {
      margin: 0.75rem 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .changes,
    .refused {
      max-height: 16rem;
      margin: 0;
      padding-left: 1.25rem;
      overflow-y: auto;
    }

    .old {
      color: var(--mat-sys-on-surface-variant);
    }

    .new {
      font-weight: 500;
    }

    p {
      margin: 0.5rem 0 0;
    }
  `,
})
export class TrackBulkRenameDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<TrackBulkRenameDialogComponent, TrackBulkRenameDialogResult>>(MatDialogRef);

  protected readonly tracks = inject<TrackBulkRenameDialogData>(MAT_DIALOG_DATA).tracks;
  private readonly titles = new Map(this.tracks.map((track) => [track.id, track.title]));
  protected readonly textMax = RENAME_TEXT_MAX;

  // Find is sent as typed: leading or trailing spaces can be part of what is removed.
  protected readonly form = new FormGroup({
    find: new FormControl<string | null>('', [
      Validators.required,
      notBlankValidator,
      Validators.maxLength(RENAME_TEXT_MAX),
    ]),
    replace: new FormControl<string | null>('', Validators.maxLength(RENAME_TEXT_MAX)),
    match_case: new FormControl(false, { nonNullable: true }),
  });

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<RenameResult | null>(null);
  protected readonly applied = signal(false);
  protected readonly canApply = computed(
    () => !this.busy() && !this.applied() && (this.result()?.changed.length ?? 0) > 0,
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.applied()) {
        this.result.set(null);
      }
    });
  }

  protected titleOf(id: number): string {
    return this.titles.get(id) ?? `#${id}`;
  }

  protected preview(): void {
    this.send(true);
  }

  protected apply(): void {
    if (this.canApply()) {
      this.send(false);
    }
  }

  protected close(): void {
    const notFound = (this.result()?.refused ?? [])
      .filter((refusal) => refusal.code === 'track_not_found')
      .map((refusal) => refusal.track_id);
    this.dialogRef.close({ notFound });
  }

  private send(dryRun: boolean): void {
    if (this.form.invalid || this.busy()) {
      return;
    }
    const value = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.api
      .post('/api/tracks/rename', {
        body: {
          track_ids: this.tracks.map((track) => track.id),
          find: value.find ?? '',
          replace: value.replace ?? '',
          match_case: value.match_case,
          dry_run: dryRun,
        },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (answer) => {
          this.busy.set(false);
          this.applied.set(!dryRun);
          this.result.set(answer);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }
}

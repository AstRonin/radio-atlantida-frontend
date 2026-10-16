import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable, concatMap, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import {
  TITLE_VALIDATORS,
  TRACK_LIMITS,
  Track,
  trackBody,
  trackForm,
  trackFormValue,
} from './track-form';

export interface TrackRenameDialogData {
  track: Track;
}

/**
 * Renames one track from the library list (docs/f19-track-titles-review-weekdays-plan.md §4.1).
 * `PUT /api/tracks/{id}` replaces the whole track, so the track is read again first and sent back
 * with only the title changed. The rename clears the reviewed mark on the backend; "Mark as
 * reviewed" sets it again after the save. Closes with `false` when nothing was saved; Escape
 * closes with `undefined`, so the caller reloads unless it gets `false`.
 */
@Component({
  selector: 'app-track-rename-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    ReactiveFormsModule,
    TranslatePipe,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'library.rename.title' | translate }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <app-text-input
          [control]="form.controls.title"
          label="library.fields.title"
          [maxLength]="titleMax"
          hint="library.rename.hint"
          hintPage="help.library"
          hintField="title"
        />
        <mat-checkbox [formControl]="form.controls.reviewed">
          {{ 'library.rename.markReviewed' | translate }}
        </mat-checkbox>
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="close()">
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="busy() || form.invalid">
          {{ 'common.save' | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class TrackRenameDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<TrackRenameDialogComponent, boolean>>(MatDialogRef);
  private readonly track = inject<TrackRenameDialogData>(MAT_DIALOG_DATA).track;

  protected readonly titleMax = TRACK_LIMITS.titleMax;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The title was saved, even if the review request after it failed. */
  private changed = false;

  protected readonly form = new FormGroup({
    title: new FormControl<string | null>(this.track.title, TITLE_VALIDATORS),
    reviewed: new FormControl(false, { nonNullable: true }),
  });

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      return;
    }
    const id = this.track.id;
    const markReviewed = this.form.controls.reviewed.value;
    this.busy.set(true);
    this.error.set(null);
    // After a failed review request, Save sends only the review again.
    const rename: Observable<unknown> = this.changed
      ? of(null)
      : this.api.get('/api/tracks/{id}', { path: { id } }).pipe(
          concatMap((stored) => {
            const form = trackForm();
            form.reset(trackFormValue(stored));
            form.controls.title.setValue(this.form.controls.title.value);
            return this.api.put('/api/tracks/{id}', {
              path: { id },
              body: trackBody(form, stored),
            });
          }),
          tap(() => (this.changed = true)),
        );
    rename
      .pipe(
        concatMap(() =>
          markReviewed
            ? this.api.post('/api/tracks/review', { body: { track_ids: [id], reviewed: true } })
            : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.dialogRef.close(true),
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(
            this.changed
              ? `${this.i18n.translate('library.rename.reviewFailed')} ${errorMessage(error, this.i18n)}`
              : applySubmitError(this.form, error, this.i18n),
          );
        },
      });
  }

  protected close(): void {
    this.dialogRef.close(this.changed);
  }
}

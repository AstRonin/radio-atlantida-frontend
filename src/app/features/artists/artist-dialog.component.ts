import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';

export type Artist = ApiSchema<'Artist'>;

export const ARTIST_NAME_MAX = 200;

export interface ArtistDialogData {
  /** The artist to rename; absent to create one. */
  artist?: Artist;
}

/** Creates or renames an artist. Names are unique, because artist separation counts by artist. */
@Component({
  selector: 'app-artist-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    ReactiveFormsModule,
    TranslatePipe,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      {{ (artist ? 'artists.dialog.renameTitle' : 'artists.dialog.createTitle') | translate }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <app-text-input
          [control]="form.controls.name"
          label="artists.fields.name"
          [maxLength]="nameMax"
        />
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" [mat-dialog-close]="undefined">
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="busy() || form.invalid">
          {{ 'common.save' | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class ArtistDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject<MatDialogRef<ArtistDialogComponent, Artist>>(MatDialogRef);

  protected readonly artist = inject<ArtistDialogData>(MAT_DIALOG_DATA).artist;
  protected readonly nameMax = ARTIST_NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl<string | null>(this.artist?.name ?? '', [
      Validators.required,
      Validators.maxLength(ARTIST_NAME_MAX),
    ]),
  });

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      return;
    }
    const body = { name: (this.form.controls.name.value ?? '').trim() };
    const request: Observable<Artist> = this.artist
      ? this.api.put('/api/artists/{id}', { path: { id: this.artist.id }, body })
      : this.api.post('/api/artists', { body });
    this.busy.set(true);
    this.error.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => this.dialogRef.close(saved),
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(applySubmitError(this.form, error, this.i18n));
      },
    });
  }
}

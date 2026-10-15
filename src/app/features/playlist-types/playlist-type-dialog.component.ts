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

export type PlaylistType = ApiSchema<'PlaylistType'>;

/** `CreatePlaylistType.code`: a lowercase slug, at most 63 characters. */
export const TYPE_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
export const TYPE_NAME_MAX = 100;

export interface PlaylistTypeDialogData {
  /** The type to rename; absent to create one. */
  type?: PlaylistType;
}

/**
 * Creates a playlist type, or renames one. The code is entered only on create and never changes
 * afterwards, because the engine and the help texts may refer to it (design §4).
 */
@Component({
  selector: 'app-playlist-type-dialog',
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
      {{
        (type ? 'playlistTypes.dialog.renameTitle' : 'playlistTypes.dialog.createTitle') | translate
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        @if (type) {
          <p class="muted">
            {{ 'playlistTypes.dialog.codeFixed' | translate: { code: type.code } }}
          </p>
        } @else {
          <app-text-input
            [control]="form.controls.code"
            label="playlistTypes.fields.code"
            hint="playlistTypes.dialog.codeHint"
            [maxLength]="63"
            [spellcheck]="false"
            hintPage="help.playlist-types"
            hintField="code"
          />
        }
        <app-text-input
          [control]="form.controls.name"
          label="playlistTypes.fields.name"
          [maxLength]="nameMax"
          hintPage="help.playlist-types"
          hintField="name"
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
export class PlaylistTypeDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<PlaylistTypeDialogComponent, PlaylistType>>(MatDialogRef);

  protected readonly type = inject<PlaylistTypeDialogData>(MAT_DIALOG_DATA).type;
  protected readonly nameMax = TYPE_NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    code: new FormControl<string | null>(
      { value: this.type?.code ?? '', disabled: this.type !== undefined },
      [Validators.required, Validators.pattern(TYPE_CODE_PATTERN)],
    ),
    name: new FormControl<string | null>(this.type?.name ?? '', [
      Validators.required,
      Validators.maxLength(TYPE_NAME_MAX),
    ]),
  });

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      return;
    }
    const name = (this.form.controls.name.value ?? '').trim();
    const request: Observable<PlaylistType> = this.type
      ? this.api.put('/api/playlist-types/{id}', { path: { id: this.type.id }, body: { name } })
      : this.api.post('/api/playlist-types', {
          body: { code: this.form.controls.code.value ?? '', name },
        });
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

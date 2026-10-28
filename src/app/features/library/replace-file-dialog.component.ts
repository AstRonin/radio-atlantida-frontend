import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema, EntityRef } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage } from '../../shared/forms/field-errors';
import { applySubmitError } from '../../shared/forms/server-errors';
import { ImportFolderSelectComponent } from '../../shared/pickers/import-folder-select.component';
import { UsedByListComponent } from '../../shared/ui/used-by-list.component';
import { Track } from './track-form';

type ImportFile = ApiSchema<'ImportFile'>;

export interface ReplaceFileDialogData {
  track: Track;
}

/**
 * What a replace changed on the track, compared with the track before it: the reviewed mark the
 * backend clears, and the start and stop points it resets when the new file is shorter.
 */
export interface ReplaceOutcome {
  reviewCleared: boolean;
  cueReset: boolean;
}

export function replaceOutcome(before: Track, after: Track): ReplaceOutcome {
  return {
    reviewCleared: !!before.reviewed_at && !after.reviewed_at,
    cueReset:
      before.cue_in_ms !== after.cue_in_ms ||
      before.cue_out_ms !== after.cue_out_ms ||
      before.fade_in_ms !== after.fade_in_ms ||
      before.fade_out_ms !== after.fade_out_ms,
  };
}

/**
 * Points a stored track at another file under the media root. The manager chooses a folder and a
 * new file of it; only files that are not a track yet can be chosen. The backend analyses the file
 * in the same request, so Save waits for the response. Closes with the updated track; a refusal
 * keeps the dialog open, with the reason and, for a track in use, what uses it.
 */
@Component({
  selector: 'app-replace-file-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatProgressBarModule,
    MatRadioModule,
    ReactiveFormsModule,
    TranslatePipe,
    ImportFolderSelectComponent,
    UsedByListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'library.replaceFile.title' | translate }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <p class="muted current">
          {{ 'library.replaceFile.current' | translate: { path: track.file_path } }}
        </p>
        <p class="muted">{{ 'library.replaceFile.note' | translate }}</p>

        @if (foldersError(); as message) {
          <p class="load-error" role="alert">
            {{ message }}
            <button matButton type="button" (click)="folders.reload()">
              {{ 'common.retry' | translate }}
            </button>
          </p>
        }
        @if (folders.isLoading()) {
          <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
        }
        @if (folders.hasValue() && folderList().length === 0) {
          <p class="muted">{{ 'library.replaceFile.noFolders' | translate }}</p>
        }
        <app-import-folder-select
          [control]="form.controls.folder"
          [folders]="folderList()"
          [root]="rootCounts()"
          [more]="foldersMore()"
        />

        @if (folder() === null) {
          <p class="muted">{{ 'import.folder.choose' | translate }}</p>
        } @else {
          @if (filesError(); as message) {
            <p class="load-error" role="alert">
              {{ message }}
              <button matButton type="button" (click)="files.reload()">
                {{ 'common.retry' | translate }}
              </button>
            </p>
          }
          @if (files.isLoading()) {
            <mat-progress-bar
              mode="indeterminate"
              [attr.aria-label]="'common.loading' | translate"
            />
          }
          @if (files.hasValue()) {
            @if (fileList().length === 0) {
              <p class="muted">{{ 'library.replaceFile.emptyFolder' | translate }}</p>
            } @else {
              <fieldset class="files">
                <legend>{{ 'library.replaceFile.files' | translate }}</legend>
                <p class="muted">{{ 'library.replaceFile.selectHint' | translate }}</p>
                @if (files.value().more) {
                  <p class="muted" role="status">{{ 'import.folder.moreFiles' | translate }}</p>
                }
                <mat-radio-group
                  class="file-list"
                  [formControl]="form.controls.file_path"
                  [attr.aria-label]="'library.replaceFile.files' | translate"
                >
                  @for (file of fileList(); track file.path) {
                    <mat-radio-button
                      class="file-row"
                      [value]="file.path"
                      [disabled]="!selectable(file)"
                    >
                      <span class="path">{{ file.path }}</span>
                      <span class="status badge">{{ statusLabel(file) }}</span>
                    </mat-radio-button>
                  }
                </mat-radio-group>
              </fieldset>
            }
          }
        }

        @if (fileError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <app-used-by-list [items]="usedBy()" />
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" [disabled]="busy()" [mat-dialog-close]="undefined">
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="busy() || form.invalid">
          {{ (busy() ? 'library.replaceFile.busy' : 'common.save') | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .current {
      margin: 0 0 0.5rem;
      overflow-wrap: anywhere;
    }

    .load-error {
      margin: 0.5rem 0;
    }

    .files {
      margin: 0.75rem 0 0;
      padding: 0;
      border: 0;
    }

    .files legend {
      padding: 0;
      margin-bottom: 0.25rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .file-list {
      display: flex;
      flex-direction: column;
      max-height: 16rem;
      overflow-y: auto;
    }

    .file-row .path {
      overflow-wrap: anywhere;
    }

    .status {
      margin-left: 0.5rem;
    }
  `,
})
export class ReplaceFileDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<ReplaceFileDialogComponent, Track>>(MatDialogRef);

  protected readonly track = inject<ReplaceFileDialogData>(MAT_DIALOG_DATA).track;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly usedBy = signal<readonly EntityRef[]>([]);

  // Control names are the ReplaceTrackFileBody's JSON name for the file, so a refusal of the
  // file lands on it. The folder only narrows the list.
  protected readonly form = new FormGroup({
    folder: new FormControl<string | null>(null),
    file_path: new FormControl<string | null>(null, Validators.required),
  });
  protected readonly fileError = controlErrorMessage(signal(this.form.controls.file_path));

  protected readonly folders = rxResource({
    stream: () => this.api.get('/api/import/folders'),
  });
  protected readonly folderList = computed(() =>
    this.folders.hasValue() ? this.folders.value().folders : [],
  );
  protected readonly rootCounts = computed(() =>
    this.folders.hasValue() ? this.folders.value().root : null,
  );
  protected readonly foldersMore = computed(
    () => this.folders.hasValue() && this.folders.value().more,
  );
  protected readonly foldersError = computed(() =>
    this.folders.status() === 'error' ? errorMessage(this.folders.error(), this.i18n) : null,
  );

  /** The chosen folder: a path, MEDIA_ROOT for the whole media folder, null before a choice. */
  protected readonly folder = toSignal(this.form.controls.folder.valueChanges, {
    initialValue: this.form.controls.folder.value,
  });

  // No folder chosen loads nothing; the media root is sent as no folder, as the import page does.
  protected readonly files = rxResource({
    params: () => {
      const folder = this.folder();
      return folder === null ? undefined : { folder };
    },
    stream: ({ params }) =>
      this.api.get('/api/import/files', { query: { folder: params.folder || undefined } }),
  });
  protected readonly fileList = computed((): readonly ImportFile[] =>
    this.files.hasValue() ? this.files.value().items : [],
  );
  protected readonly filesError = computed(() =>
    this.files.status() === 'error' ? errorMessage(this.files.error(), this.i18n) : null,
  );

  constructor() {
    // A new folder clears the file chosen in the previous one.
    this.form.controls.folder.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.form.controls.file_path.setValue(null);
    });
  }

  /** Only a new file can replace the track; the others are shown with why they cannot. */
  protected selectable(file: ImportFile): boolean {
    return file.status === 'new' && file.track_id !== this.track.id;
  }

  protected statusLabel(file: ImportFile): string {
    const status = this.i18n.translate(`import.folder.statuses.${file.status}`);
    return file.track_id === this.track.id
      ? `${status}, ${this.i18n.translate('library.replaceFile.currentFile')}`
      : status;
  }

  protected save(): void {
    const path = this.form.controls.file_path.value;
    if (this.form.invalid || path === null || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const body: ApiSchema<'ReplaceTrackFileBody'> = { file_path: path };
    const request: Observable<Track> = this.api.post('/api/tracks/{id}/replace-file', {
      path: { id: this.track.id },
      body,
    });
    this.busy.set(true);
    this.error.set(null);
    this.usedBy.set([]);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => this.dialogRef.close(saved),
      error: (error: unknown) => {
        this.busy.set(false);
        this.usedBy.set(error instanceof ApiProblem ? error.used_by : []);
        this.error.set(applySubmitError(this.form, error, this.i18n));
      },
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { merge } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { followOperation } from '../../core/operations/operation-run';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { PlaylistTypeSelectComponent } from '../../shared/forms/playlist-type-select.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { PlaylistPickerComponent } from '../../shared/pickers/playlist-picker.component';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { FileSizePipe } from '../../shared/ui/file-size.pipe';

type InboxFile = ApiSchema<'InboxFile'>;

/**
 * The import (design §8.7, backend phase 11): new files are copied into the inbox folder on the
 * station computer, never uploaded through the panel. The page lists the inbox and imports it as
 * one batch with a type and playlists; the backend reads tags, analyses each file against the
 * broadcast standard, and moves it into the library folder.
 */
@Component({
  selector: 'app-import-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    StationTimePipe,
    FileSizePipe,
    OperationStatusComponent,
    PageHeaderComponent,
    PlaylistPickerComponent,
    PlaylistTypeSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="import.title" helpPage="help.import">
      <button matButton type="button" [disabled]="inbox.isLoading()" (click)="inbox.reload()">
        {{ 'import.refresh' | translate }}
      </button>
    </app-page-header>

    <section class="page-section" aria-labelledby="inbox-heading">
      <h2 id="inbox-heading" class="section-title">
        @if (inboxDir(); as dir) {
          {{ 'import.inbox.titleIn' | translate: { dir } }}
        } @else {
          {{ 'import.inbox.title' | translate }}
        }
      </h2>
      @if (inbox.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (inboxError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="inbox.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      @if (inbox.hasValue()) {
        @if (files().length === 0) {
          <p class="muted">{{ 'import.inbox.empty' | translate: { dir: inbox.value().dir } }}</p>
        } @else {
          <p class="muted">
            {{ 'import.inbox.count' | translate: { count: files().length } }}
            @if (inbox.value().more) {
              {{ 'import.inbox.more' | translate }}
            }
          </p>
          <div class="table-scroll">
            <table mat-table [dataSource]="files()">
              <ng-container matColumnDef="path">
                <th mat-header-cell *matHeaderCellDef>{{ 'import.inbox.path' | translate }}</th>
                <td mat-cell *matCellDef="let file" class="path">{{ file.path }}</td>
              </ng-container>
              <ng-container matColumnDef="size">
                <th mat-header-cell *matHeaderCellDef>{{ 'import.inbox.size' | translate }}</th>
                <td mat-cell *matCellDef="let file" class="numeric">{{ file.size | fileSize }}</td>
              </ng-container>
              <ng-container matColumnDef="modified">
                <th mat-header-cell *matHeaderCellDef>
                  {{ 'import.inbox.modified' | translate }}
                </th>
                <td mat-cell *matCellDef="let file">
                  <time [attr.datetime]="file.modified_at">{{
                    file.modified_at | stationTime
                  }}</time>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        }
      }
    </section>

    <section class="page-section" aria-labelledby="import-heading">
      <h2 id="import-heading" class="section-title">{{ 'import.form.title' | translate }}</h2>
      <p class="muted">{{ 'import.form.intro' | translate }}</p>
      <form [formGroup]="form" (ngSubmit)="startImport()">
        <div class="form-grid">
          <app-playlist-type-select
            [control]="form.controls.type_id"
            label="import.form.type_id"
            hintPage="help.import"
            hintField="type_id"
          />
          <app-playlist-picker
            [control]="form.controls.playlist_ids"
            label="import.form.playlist_ids"
            hintPage="help.import"
            hintField="playlist_ids"
          />
        </div>
        @if (importError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <div class="form-actions">
          <button matButton="filled" type="submit" [disabled]="!canImport()">
            {{ 'import.form.start' | translate }}
          </button>
        </div>
      </form>
      <app-operation-status [state]="importRun.state()" runningLabel="import.form.running" />
      @if (importRun.state()?.status === 'completed') {
        <p>
          <a routerLink="/library" [queryParams]="{ quality: 'issues' }">{{
            'import.form.showIssues' | translate
          }}</a>
        </p>
      }
    </section>

    <section class="page-section" aria-labelledby="analyse-heading">
      <h2 id="analyse-heading" class="section-title">{{ 'import.analyse.title' | translate }}</h2>
      <p class="muted">{{ 'import.analyse.intro' | translate }}</p>
      @if (analyseError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button
          matButton="outlined"
          type="button"
          [disabled]="analyseRun.running()"
          (click)="analyseNew()"
        >
          {{ 'import.analyse.start' | translate }}
        </button>
      </div>
      <app-operation-status [state]="analyseRun.state()" runningLabel="import.analyse.running" />
    </section>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .path {
      overflow-wrap: anywhere;
    }

    .numeric {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export default class ImportPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = ['path', 'size', 'modified'];

  protected readonly inbox = rxResource({
    stream: () => this.api.get('/api/import/inbox'),
  });
  protected readonly files = computed((): readonly InboxFile[] =>
    this.inbox.hasValue() ? this.inbox.value().items : [],
  );
  protected readonly inboxDir = computed(() =>
    this.inbox.hasValue() ? this.inbox.value().dir : null,
  );
  protected readonly inboxError = computed(() =>
    this.inbox.status() === 'error' ? errorMessage(this.inbox.error(), this.i18n) : null,
  );

  // Control names are the ImportBody's JSON names, so per-field refusals land on them.
  protected readonly form = new FormGroup({
    type_id: new FormControl<number | null>(null, Validators.required),
    playlist_ids: new FormControl<number[] | null>([]),
  });
  private readonly version = controlVersion(signal(this.form));

  protected readonly importRun = followOperation();
  protected readonly importError = signal<string | null>(null);
  protected readonly analyseRun = followOperation();
  protected readonly analyseError = signal<string | null>(null);

  /** An inbox known to be empty has nothing to import; one that failed to load may still. */
  protected readonly canImport = computed(() => {
    this.version();
    const empty = this.inbox.hasValue() && this.inbox.value().items.length === 0;
    return this.form.valid && !empty && !this.importRun.running();
  });

  constructor() {
    // Imported files leave the inbox, also when the import was started elsewhere.
    const realtime = inject(RealtimeService);
    merge(realtime.on('import.completed'), realtime.on('import.failed'))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.inbox.reload());
  }

  protected startImport(): void {
    const value = this.form.getRawValue();
    if (this.form.invalid || value.type_id === null || this.importRun.running()) {
      this.form.markAllAsTouched();
      return;
    }
    const body: ApiSchema<'ImportBody'> = {
      type_id: value.type_id,
      playlist_ids: value.playlist_ids ?? [],
    };
    this.importError.set(null);
    // A failed operation is already an error.alert popup; the status line names it.
    this.importRun
      .run(this.api.post('/api/import', { body }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (error: unknown) =>
          this.importError.set(applySubmitError(this.form, error, this.i18n)),
      });
  }

  protected analyseNew(): void {
    this.analyseError.set(null);
    this.analyseRun
      .run(this.api.post('/api/tracks/analyse', { body: {} }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (error: unknown) => this.analyseError.set(errorMessage(error, this.i18n)),
      });
  }
}

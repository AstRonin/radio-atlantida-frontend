import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
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
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { PlaylistPickerComponent } from '../../shared/pickers/playlist-picker.component';
import { FileSizePipe } from '../../shared/ui/file-size.pipe';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { providePaginatorIntl } from '../../shared/ui/paginator-intl';
import {
  ImportFolderSelectComponent,
  MEDIA_ROOT,
} from '../../shared/pickers/import-folder-select.component';

type ImportFile = ApiSchema<'ImportFile'>;

// A folder may hold hundreds of files (the backend lists up to 2,000); the page shows them in pages.
const PAGE_SIZES = [10, 25, 50, 100];

// The whole media folder is the empty path, which `Validators.required` would refuse.
function folderChosen(control: AbstractControl<string | null>): ValidationErrors | null {
  return control.value === null ? { required: true } : null;
}

/**
 * The import in place (design §8.7, backend phase 18): the station's audio lies in folders of the
 * media root, never uploaded through the panel. The manager chooses a folder, sees which of its
 * files are new, and imports the new ones as one batch with a type, playlists, and an artist; the
 * files stay where they are. The folders, paths, counts, and statuses are the backend's; the page
 * only shows them and sends one folder back.
 */
@Component({
  selector: 'app-import-page',
  imports: [
    MatButtonModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    StationTimePipe,
    FileSizePipe,
    ArtistSelectComponent,
    ImportFolderSelectComponent,
    OperationStatusComponent,
    PageHeaderComponent,
    PlaylistPickerComponent,
    PlaylistTypeSelectComponent,
  ],
  providers: [providePaginatorIntl()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="import.title" helpPage="help.import">
      <button
        matButton
        type="button"
        [disabled]="folders.isLoading() || files.isLoading()"
        (click)="reload()"
      >
        {{ 'import.refresh' | translate }}
      </button>
    </app-page-header>

    <section class="page-section" aria-labelledby="folder-heading">
      <h2 id="folder-heading" class="section-title">{{ 'import.folder.title' | translate }}</h2>
      @if (foldersError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="folders.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <app-import-folder-select
        [control]="form.controls.folder"
        [folders]="folderList()"
        [root]="rootCounts()"
        [more]="foldersMore()"
      />
      @if (goneFolder(); as path) {
        <p class="form-error" role="status">{{ 'import.folder.gone' | translate: { path } }}</p>
      }
      @if (folders.isLoading() || files.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (chosen() === null) {
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
        @if (files.hasValue()) {
          @if (chosenCounts(); as counts) {
            <p class="muted">
              {{
                'import.folder.counts'
                  | translate: { new: counts.new_files, total: counts.audio_files }
              }}
            </p>
          }
          @if (fileList().length === 0) {
            <p class="muted">{{ 'import.folder.empty' | translate }}</p>
          } @else {
            @if (files.value().more) {
              <p class="muted">{{ 'import.folder.moreFiles' | translate }}</p>
            }
            <div class="table-scroll">
              <table mat-table [dataSource]="pageFiles()">
                <ng-container matColumnDef="path">
                  <th mat-header-cell *matHeaderCellDef>
                    {{ 'import.folder.columns.path' | translate }}
                  </th>
                  <td mat-cell *matCellDef="let file" class="path">{{ file.path }}</td>
                </ng-container>
                <ng-container matColumnDef="size">
                  <th mat-header-cell *matHeaderCellDef>
                    {{ 'import.folder.columns.size' | translate }}
                  </th>
                  <td mat-cell *matCellDef="let file" class="numeric">
                    {{ file.size | fileSize }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="modified">
                  <th mat-header-cell *matHeaderCellDef>
                    {{ 'import.folder.columns.modified' | translate }}
                  </th>
                  <td mat-cell *matCellDef="let file">
                    <time [attr.datetime]="file.modified_at">{{
                      file.modified_at | stationTime
                    }}</time>
                  </td>
                </ng-container>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>
                    {{ 'import.folder.columns.status' | translate }}
                  </th>
                  <td mat-cell *matCellDef="let file">
                    @let label = 'import.folder.statuses.' + file.status | translate;
                    @if (trackOf(file); as id) {
                      <a class="badge" [routerLink]="['/library', id]">{{ label }}</a>
                    } @else {
                      <span class="badge" [class.new]="file.status === 'new'">{{ label }}</span>
                    }
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns"></tr>
              </table>
            </div>
            @if (fileList().length > pageSizes[0]) {
              <mat-paginator
                [length]="fileList().length"
                [pageIndex]="pageIndex()"
                [pageSize]="pageSize()"
                [pageSizeOptions]="pageSizes"
                showFirstLastButtons
                (page)="onPage($event)"
              />
            }
          }
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
          <app-artist-select
            [control]="form.controls.artist_id"
            label="import.form.artist_id"
            hintPage="help.import"
            hintField="artist_id"
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
      @if (analysing()) {
        <!-- The import bar reaches its end before the analysis of the new tracks does. -->
        <div class="analysis-status">
          <mat-progress-bar
            mode="determinate"
            [value]="analysisPercent() ?? 0"
            [attr.aria-label]="'import.form.analysing' | translate"
          />
          <p class="muted" role="status">
            {{ 'import.form.analysing' | translate }}
            {{
              'operations.progress'
                | translate: { done: analysisDone() ?? 0, total: analysisTotal() }
            }}
          </p>
        </div>
      }
      @if (importRun.state()?.status === 'completed') {
        <p class="links">
          <a routerLink="/library" [queryParams]="{ reviewed: 'false' }">{{
            'import.form.reviewNew' | translate
          }}</a>
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

    .analysis-status p {
      margin: 0.5rem 0 0;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
    }

    .numeric {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .badge.new {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    a.badge {
      text-decoration: underline;
    }
  `,
})
export default class ImportPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = ['path', 'size', 'modified', 'status'];

  // Control names are the ImportBody's JSON names, so per-field refusals land on them.
  protected readonly form = new FormGroup({
    folder: new FormControl<string | null>(null, folderChosen),
    type_id: new FormControl<number | null>(null, Validators.required),
    playlist_ids: new FormControl<number[] | null>([]),
    artist_id: new FormControl<number | null>(null),
  });
  private readonly version = controlVersion(signal(this.form));

  /** The chosen folder: a path, `MEDIA_ROOT` for the whole media folder, null before a choice. */
  protected readonly chosen = toSignal(this.form.controls.folder.valueChanges, {
    initialValue: this.form.controls.folder.value,
  });
  /** A chosen folder that a reload no longer listed, so the choice was cleared. */
  protected readonly goneFolder = signal<string | null>(null);

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

  /** The counts of the chosen folder; null when it is not in the loaded list. */
  protected readonly chosenCounts = computed((): ApiSchema<'ImportCounts'> | null => {
    const folder = this.chosen();
    if (folder === MEDIA_ROOT) {
      return this.rootCounts();
    }
    return this.folderList().find((item) => item.path === folder) ?? null;
  });

  // A new choice cancels the listing in flight; no choice loads nothing.
  protected readonly files = rxResource({
    params: () => {
      const folder = this.chosen();
      return folder === null ? undefined : { folder };
    },
    stream: ({ params }) =>
      this.api.get('/api/import/files', { query: { folder: params.folder || undefined } }),
  });
  protected readonly fileList = computed((): readonly ImportFile[] =>
    this.files.hasValue() ? this.files.value().items : [],
  );
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly pageSize = signal(PAGE_SIZES[0]);
  private readonly requestedPage = signal(0);
  /** The requested page, moved back when a reload leaves fewer files. */
  protected readonly pageIndex = computed(() => {
    const last = Math.max(0, Math.ceil(this.fileList().length / this.pageSize()) - 1);
    return Math.min(this.requestedPage(), last);
  });
  protected readonly pageFiles = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.fileList().slice(start, start + this.pageSize());
  });
  protected readonly filesError = computed(() =>
    this.files.status() === 'error' ? errorMessage(this.files.error(), this.i18n) : null,
  );

  protected readonly importRun = followOperation();
  protected readonly importError = signal<string | null>(null);
  /** The latest `track.analysed` of the running import: tracks done and total; null before one. */
  protected readonly analysisDone = signal<number | null>(null);
  protected readonly analysisTotal = signal(0);
  /** Analysis events that came before the import's operation id was known, latest per operation. */
  private readonly earlyAnalysis = new Map<number, { done: number; total: number }>();
  /** The analysis bar: shown while the import runs and its first analysed track has arrived. */
  protected readonly analysing = computed(
    () => this.importRun.running() && this.analysisDone() !== null,
  );
  protected readonly analysisPercent = computed(() => {
    const total = this.analysisTotal();
    const done = this.analysisDone();
    return done !== null && total > 0 ? Math.round((100 * done) / total) : null;
  });
  protected readonly analyseRun = followOperation();
  protected readonly analyseError = signal<string | null>(null);

  /** A folder known to have no new files has nothing to import; one not listed may still. */
  protected readonly canImport = computed(() => {
    this.version();
    const nothingNew = this.chosenCounts()?.new_files === 0;
    return this.form.valid && !nothingNew && !this.importRun.running();
  });

  constructor() {
    // Counts and statuses change after an import, also when it was started elsewhere.
    const realtime = inject(RealtimeService);
    merge(realtime.on('import.completed'), realtime.on('import.failed'))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reload());

    // The analysis of an import runs in the same operation, one event per track. Events of other
    // operations (an analyse run, say) are not this import's, and are ignored. The backend may
    // analyse the first tracks before the start response names the operation: until then, the
    // latest event per operation is kept, and the effect below applies it once the id is known.
    realtime
      .on('track.analysed')
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (!this.importRun.running()) {
          return;
        }
        const operation = this.importRun.state();
        const progress = { done: event.data.done, total: event.data.total };
        if (operation === null) {
          this.earlyAnalysis.set(event.data.operation_id, progress);
        } else if (event.data.operation_id === operation.id) {
          this.earlyAnalysis.clear();
          this.analysisDone.set(progress.done);
          this.analysisTotal.set(progress.total);
        }
      });

    // The operation id is known from the start response on: apply the analysis that came earlier.
    effect(() => {
      const id = this.importRun.state()?.id;
      if (id === undefined) {
        return;
      }
      untracked(() => {
        const early = this.earlyAnalysis.get(id);
        this.earlyAnalysis.clear();
        if (early !== undefined) {
          this.analysisDone.set(early.done);
          this.analysisTotal.set(early.total);
        }
      });
    });

    this.form.controls.folder.valueChanges.pipe(takeUntilDestroyed()).subscribe((folder) => {
      // Another folder starts at its first page; a reload of the same one keeps the page.
      this.requestedPage.set(0);
      if (folder !== null) {
        this.goneFolder.set(null);
      }
    });

    // A folder deleted on disk drops out of the list. With `more` it may only be past the limit,
    // so it is kept and the backend refuses it if it is really gone.
    effect(() => {
      if (!this.folders.hasValue() || this.folders.isLoading()) {
        return;
      }
      const { folders, more } = this.folders.value();
      untracked(() => {
        const folder = this.form.controls.folder.value;
        if (folder === null || folder === MEDIA_ROOT || more) {
          return;
        }
        if (!folders.some((item) => item.path === folder)) {
          this.form.controls.folder.setValue(null);
          this.goneFolder.set(folder);
        }
      });
    });
  }

  protected trackOf(file: ImportFile): number | null {
    const linked = file.status === 'in_library' || file.status === 'original';
    return linked ? (file.track_id ?? null) : null;
  }

  protected onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.requestedPage.set(event.pageIndex);
  }

  protected reload(): void {
    this.folders.reload();
    this.files.reload();
  }

  protected startImport(): void {
    const value = this.form.getRawValue();
    if (!this.canImport() || value.folder === null || value.type_id === null) {
      this.form.markAllAsTouched();
      return;
    }
    // The whole media folder is sent as no folder, and no artist as no artist_id.
    const body: ApiSchema<'ImportBody'> = {
      type_id: value.type_id,
      playlist_ids: value.playlist_ids ?? [],
      ...(value.folder === MEDIA_ROOT ? {} : { folder: value.folder }),
      ...(value.artist_id === null ? {} : { artist_id: value.artist_id }),
    };
    this.importError.set(null);
    this.analysisDone.set(null);
    this.analysisTotal.set(0);
    this.earlyAnalysis.clear();
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

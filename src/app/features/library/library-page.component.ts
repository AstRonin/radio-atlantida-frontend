import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  merge,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { errorMessage } from '../../core/api/problem-message';
import { ApiClient } from '../../core/api/api-client.service';
import { CatalogService, TrackQuery, catalogList } from '../../core/catalog/catalog.service';
import { I18nService, TranslationParams } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { providePaginatorIntl } from '../../shared/ui/paginator-intl';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import { BULK_DELETE_MAX, trackBulkDelete } from './track-bulk-delete';
import { TrackDeleteResultComponent } from './track-delete-result.component';
import type { Track } from './track-form';
import {
  DEFAULT_LIST_STATE,
  LIBRARY_PAGE_SIZES,
  LibraryListState,
  isTrackSort,
  listStateParams,
  readListState,
} from './library-list-state';
import { MediaRequest, trackMedia } from './track-media';
import { TrackMediaActionsComponent } from './track-media-actions.component';
import { TrackQualityComponent } from './track-quality.component';

export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;

type Quality = NonNullable<TrackQuery['quality']>;
const QUALITIES: readonly Quality[] = ['ok', 'issues', 'unanalysed'];

interface PageRequest {
  query: TrackQuery;
  /** Set on the read of the last page after a page came back empty, so it happens once. */
  corrected?: boolean;
}

/**
 * The track library (docs/frontend-init-plan.md F5): search by title or artist, filters by
 * playlist, type, and quality, a play button on every row. The backend sorts and pages the whole
 * filtered list (F18); the page, its size, and the order are kept in the URL. Selected tracks,
 * on any page, can be analysed again or fixed (F10), or deleted with one request (F17).
 */
@Component({
  selector: 'app-library-page',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    PageHeaderComponent,
    OperationStatusComponent,
    PlayButtonComponent,
    TrackDeleteResultComponent,
    TrackMediaActionsComponent,
    TrackQualityComponent,
  ],
  providers: [providePaginatorIntl()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="library.title" helpPage="help.library">
      <a matButton="filled" routerLink="/library/new">{{ 'library.add' | translate }}</a>
    </app-page-header>

    <form class="list-filters" [formGroup]="filters" role="search">
      <mat-form-field>
        <mat-label>{{ 'library.filters.search' | translate }}</mat-label>
        <input matInput type="search" formControlName="q" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.playlist' | translate }}</mat-label>
        <mat-select formControlName="playlist_id">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (playlist of playlists().items; track playlist.id) {
            <mat-option [value]="playlist.id">{{ playlist.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.type' | translate }}</mat-label>
        <mat-select formControlName="type_id">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (type of types().items; track type.id) {
            <mat-option [value]="type.id">{{ type.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.quality' | translate }}</mat-label>
        <mat-select formControlName="quality">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (quality of qualities; track quality) {
            <mat-option [value]="quality">{{
              'library.quality.' + quality | translate
            }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </form>

    @if (
      selectedTracks().length > 0 ||
      media.run.state() ||
      bulkDelete.running() ||
      bulkDelete.result() ||
      bulkDelete.error()
    ) {
      <section class="page-section selection" aria-labelledby="selection-heading">
        <h2 id="selection-heading" class="section-title">
          {{ 'library.media.selected' | translate: { count: selectedTracks().length } }}
          @if (selectedTracks().length > 0) {
            <button matButton type="button" (click)="clearSelection()">
              {{ 'library.media.clearSelection' | translate }}
            </button>
            <button
              matButton
              type="button"
              class="danger"
              [disabled]="tooManyToDelete() || bulkDelete.running() || media.run.running()"
              (click)="deleteSelected()"
            >
              {{ 'library.bulkDelete.delete' | translate: { count: selectedTracks().length } }}
            </button>
          }
        </h2>
        @if (tooManyToDelete()) {
          <p class="muted">{{ 'library.bulkDelete.tooMany' | translate }}</p>
        }
        <app-track-media-actions
          [tracks]="selectedTracks()"
          [running]="media.run.running() || bulkDelete.running()"
          (request)="startMedia($event)"
        />
        @if (media.error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <app-operation-status [state]="media.run.state()" runningLabel="library.media.running" />
        @if (bulkDelete.count(); as count) {
          <div role="status">
            <mat-progress-bar
              mode="indeterminate"
              [attr.aria-label]="'library.bulkDelete.running' | translate: { count }"
            />
            <p class="muted">{{ 'library.bulkDelete.running' | translate: { count } }}</p>
          </div>
        }
        @if (bulkDelete.error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (bulkDelete.result(); as result) {
          <app-track-delete-result [result]="result" />
        }
      </section>
    }

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="reload()">{{ 'common.retry' | translate }}</button>
      </p>
    }

    <div class="table-scroll">
      <!-- A plain array as the data source: MatSort only reports the click, the backend sorts. -->
      <table
        mat-table
        [dataSource]="rows()"
        matSort
        [matSortActive]="list().sort"
        [matSortDirection]="list().order"
        matSortDisableClear
        matSortStart="asc"
        (matSortChange)="onSort($event)"
      >
        <ng-container matColumnDef="select">
          <th mat-header-cell *matHeaderCellDef>
            <mat-checkbox
              [checked]="allSelected()"
              [indeterminate]="someSelected() && !allSelected()"
              [disabled]="rows().length === 0"
              [aria-label]="'library.media.selectAll' | translate"
              (change)="selectAll($event.checked)"
            />
          </th>
          <td mat-cell *matCellDef="let track">
            <mat-checkbox
              [checked]="selected().has(track.id)"
              [aria-label]="'library.media.select' | translate: { title: track.title }"
              (change)="select(track, $event.checked)"
            />
          </td>
        </ng-container>
        <ng-container matColumnDef="play">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'library.preview' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let track"><app-play-button [track]="track" /></td>
        </ng-container>
        <ng-container matColumnDef="title">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.title' | translate) }
            "
          >
            {{ 'library.fields.title' | translate }}
          </th>
          <td mat-cell *matCellDef="let track">
            <a [routerLink]="['/library', track.id]">{{ track.title }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="artist">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.artist_id' | translate) }
            "
          >
            {{ 'library.fields.artist_id' | translate }}
          </th>
          <td mat-cell *matCellDef="let track">{{ track.artist?.name }}</td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.type_id' | translate) }
            "
          >
            {{ 'library.fields.type_id' | translate }}
          </th>
          <td mat-cell *matCellDef="let track">
            <span class="badge">{{ track.type.name }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="duration">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.duration_ms' | translate) }
            "
          >
            {{ 'library.fields.duration_ms' | translate }}
          </th>
          <td mat-cell *matCellDef="let track" class="numeric">
            @if (track.duration_ms) {
              {{ track.duration_ms | duration }}
            } @else {
              <span class="badge warn">{{ 'library.noDuration' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="format">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.format' | translate) }
            "
          >
            {{ 'library.fields.format' | translate }}
          </th>
          <td mat-cell *matCellDef="let track">{{ track.format }}</td>
        </ng-container>
        <ng-container matColumnDef="quality">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.quality_ok' | translate) }
            "
          >
            {{ 'library.fields.quality_ok' | translate }}
          </th>
          <td mat-cell *matCellDef="let track"><app-track-quality [track]="track" /></td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let track" class="cell-actions">
            <a matButton [routerLink]="['/library', track.id]">{{ 'common.edit' | translate }}</a>
            <button matButton type="button" (click)="remove(track)">
              {{ 'common.delete' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!loading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>

    <mat-paginator
      [length]="total()"
      [pageIndex]="list().pageIndex"
      [pageSize]="list().pageSize"
      [pageSizeOptions]="pageSizes"
      showFirstLastButtons
      (page)="onPage($event)"
    />
    <p class="page-status cdk-visually-hidden" role="status">
      @if (pageStatus(); as status) {
        {{ 'library.pageStatus' | translate: status }}
      }
    </p>
  `,
  styles: `
    .section-title {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .numeric {
      font-variant-numeric: tabular-nums;
    }

    .danger {
      --mat-button-text-label-text-color: var(--mat-sys-error);
    }
  `,
})
export default class LibraryPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Query parameter `quality`, as the import's "tracks with issues" link sets it. */
  readonly quality = input<string>();
  /** Query parameters of the list state (library-list-state.ts), read once when the page opens. */
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();
  readonly order = input<string>();

  protected readonly columns = [
    'select',
    'play',
    'title',
    'artist',
    'type',
    'duration',
    'format',
    'quality',
    'actions',
  ];
  protected readonly qualities = QUALITIES;
  protected readonly pageSizes = LIBRARY_PAGE_SIZES;
  protected readonly playlists = catalogList(this.catalog.playlists());
  protected readonly types = catalogList(this.catalog.playlistTypes());

  protected readonly filters = new FormGroup({
    q: new FormControl(''),
    playlist_id: new FormControl<number | null>(null),
    type_id: new FormControl<number | null>(null),
    quality: new FormControl<Quality | null>(null),
  });

  protected readonly list = signal<LibraryListState>(DEFAULT_LIST_STATE);
  protected readonly rows = signal<readonly Track[]>([]);
  protected readonly total = signal(0);
  /** Set when a page arrives, not when it is asked for, so the announcement matches the rows. */
  protected readonly pageStatus = signal<TranslationParams | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /**
   * Selected tracks by ID, on any page: changing the page or the sort keeps them, a reload
   * refreshes the ones on the page it reads (new fixes, title), and a filter change clears them.
   * Deleted tracks are removed explicitly, since a track missing from one page may be on another.
   */
  protected readonly selected = signal<ReadonlyMap<number, Track>>(new Map());
  protected readonly selectedTracks = computed(() => [...this.selected().values()]);
  protected readonly tooManyToDelete = computed(() => this.selected().size > BULK_DELETE_MAX);
  /** The header checkbox looks at the current page only. */
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((track) => this.selected().has(track.id)),
  );
  protected readonly someSelected = computed(() =>
    this.rows().some((track) => this.selected().has(track.id)),
  );

  /** The tracks changed, so their rows and fixes are read again. */
  protected readonly media = trackMedia((state) => {
    if (state.status === 'completed') {
      this.clearSelection();
    }
    this.reload();
  });

  /** Deleted tracks leave the selection; refused ones stay selected, so the manager sees them. */
  protected readonly bulkDelete = trackBulkDelete((deleted) => {
    this.deselect(deleted);
    this.reload();
  });

  private readonly pages = new Subject<PageRequest>();
  /** The filters only; the page and the order come from `list`. */
  private filterQuery: TrackQuery = {};

  constructor() {
    this.pages
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.loadError.set(null);
          return this.api.get('/api/tracks', { query: request.query }).pipe(
            map((page) => ({ request, page, error: null as unknown })),
            catchError((error: unknown) => of({ request, page: null, error })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ request, page, error }) => {
        this.loading.set(false);
        if (!page) {
          this.loadError.set(errorMessage(error, this.i18n));
          return;
        }
        const { pageSize } = this.list();
        const offset = request.query.offset ?? 0;
        if (page.items.length === 0 && offset > 0 && page.total > 0 && !request.corrected) {
          // The last page was emptied, by a delete here or elsewhere: show the new last page.
          this.setList({ ...this.list(), pageIndex: Math.ceil(page.total / pageSize) - 1 });
          this.pages.next({ query: this.pageQuery(), corrected: true });
          return;
        }
        this.rows.set(page.items);
        this.total.set(page.total);
        this.pageStatus.set({
          page: this.list().pageIndex + 1,
          pages: Math.max(1, Math.ceil(page.total / pageSize)),
          total: page.total,
        });
        this.refreshSelection();
      });

    // Tracks imported, analysed, or fixed, here or elsewhere.
    const realtime = inject(RealtimeService);
    merge(
      realtime.on('import.completed'),
      realtime.on('analyse.completed'),
      realtime.on('transcode.completed'),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  ngOnInit(): void {
    // Router inputs are set before the first change detection, not in the constructor.
    const quality = this.quality();
    if (QUALITIES.includes(quality as Quality)) {
      this.filters.controls.quality.setValue(quality as Quality, { emitEvent: false });
    }
    this.list.set(
      readListState({
        page: this.page(),
        size: this.size(),
        sort: this.sort(),
        order: this.order(),
      }),
    );
    let first = true;

    // One debounce for every filter, so typing in the search reads one page after a pause.
    this.filters.valueChanges
      .pipe(
        debounceTime(LIBRARY_SEARCH_DEBOUNCE_MS),
        startWith(this.filters.value),
        map((value): TrackQuery => ({
          q: value.q?.trim() || undefined,
          playlist_id: value.playlist_id ?? undefined,
          type_id: value.type_id ?? undefined,
          quality: value.quality ?? undefined,
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((query) => {
        this.clearSelection();
        this.filterQuery = query;
        // The page from the URL holds for the first read; another filter starts at page 1.
        if (!first) {
          this.setList({ ...this.list(), pageIndex: 0 });
        }
        first = false;
        this.reload();
      });
  }

  protected onSort(sort: Sort): void {
    if (!isTrackSort(sort.active)) {
      return;
    }
    this.setList({
      ...this.list(),
      sort: sort.active,
      order: sort.direction || 'asc',
      pageIndex: 0,
    });
    this.reload();
  }

  /** A new page size comes with the paginator's page that holds the first row of the old one. */
  protected onPage(event: PageEvent): void {
    this.setList({ ...this.list(), pageIndex: event.pageIndex, pageSize: event.pageSize });
    this.reload();
  }

  protected select(track: Track, checked: boolean): void {
    this.bulkDelete.clear();
    this.selected.update((selected) => {
      const next = new Map(selected);
      if (checked) {
        next.set(track.id, track);
      } else {
        next.delete(track.id);
      }
      return next;
    });
  }

  protected selectAll(checked: boolean): void {
    this.bulkDelete.clear();
    this.selected.update((selected) => {
      const next = new Map(selected);
      for (const track of this.rows()) {
        if (checked) {
          next.set(track.id, track);
        } else {
          next.delete(track.id);
        }
      }
      return next;
    });
  }

  private refreshSelection(): void {
    if (this.selected().size === 0) {
      return;
    }
    this.selected.update((selected) => {
      const next = new Map(selected);
      for (const track of this.rows()) {
        if (next.has(track.id)) {
          next.set(track.id, track);
        }
      }
      return next;
    });
  }

  private deselect(ids: readonly number[]): void {
    if (ids.some((id) => this.selected().has(id))) {
      this.selected.update((selected) => {
        const next = new Map(selected);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  protected clearSelection(): void {
    this.bulkDelete.clear();
    this.selected.set(new Map());
  }

  protected startMedia(request: MediaRequest): void {
    this.bulkDelete.clear();
    this.media.start(request);
  }

  protected deleteSelected(): void {
    const ids = this.selectedTracks().map((track) => track.id);
    this.bulkDelete.clear();
    this.confirm
      .confirm({
        title: 'library.bulkDelete.confirmTitle',
        message: 'library.bulkDelete.confirmMessage',
        params: { count: ids.length },
        confirmLabel: 'common.delete',
        destructive: true,
      })
      .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.bulkDelete.start(ids));
  }

  /** Reads the current page in the current order again. */
  protected reload(): void {
    this.pages.next({ query: this.pageQuery() });
  }

  private pageQuery(): TrackQuery {
    const { pageIndex, pageSize, sort, order } = this.list();
    return { ...this.filterQuery, sort, order, offset: pageIndex * pageSize, limit: pageSize };
  }

  /** Coming back from a track, or reloading the browser, then opens the same page. */
  private setList(state: LibraryListState): void {
    this.list.set(state);
    void this.router.navigate([], {
      relativeTo: this.route,
      // Written with the page, so a quality chosen here does not lose to the one in the URL.
      queryParams: { ...listStateParams(state), quality: this.filters.value.quality ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected remove(track: Track): void {
    this.confirm
      .confirmDelete({
        name: track.title,
        action: () => this.api.delete('/api/tracks/{id}', { path: { id: track.id } }),
      })
      .subscribe((deleted) => {
        if (deleted) {
          this.deselect([track.id]);
          this.reload();
        }
      });
  }
}

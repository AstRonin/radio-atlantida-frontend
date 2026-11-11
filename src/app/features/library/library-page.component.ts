import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  asyncScheduler,
  merge,
  of,
  startWith,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';
import { errorMessage } from '../../core/api/problem-message';
import { ApiClient } from '../../core/api/api-client.service';
import { CatalogService, TrackQuery, catalogList } from '../../core/catalog/catalog.service';
import { I18nService, TranslationParams } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { providePaginatorIntl } from '../../shared/ui/paginator-intl';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import { BULK_DELETE_MAX, trackBulkDelete } from './track-bulk-delete';
import {
  BULK_RENAME_MAX,
  TrackBulkRenameDialogComponent,
  TrackBulkRenameDialogData,
  TrackBulkRenameDialogResult,
} from './track-bulk-rename-dialog.component';
import { TrackDeleteResultComponent } from './track-delete-result.component';
import type { Track } from './track-form';
import {
  DEFAULT_LIST_STATE,
  InPlanFilter,
  LIBRARY_PAGE_SIZES,
  LibraryListState,
  ReviewedFilter,
  isTrackSort,
  listStateParams,
  readInPlanFilter,
  readArtistFilter,
  readListState,
  readReviewedFilter,
  readWithoutPlaylist,
} from './library-list-state';
import { LibraryCursorService } from './library-cursor';
import { LibraryStatsComponent, LibraryStatsFilter, TrackStats } from './library-stats.component';
import { MediaRequest, trackMedia } from './track-media';
import { TrackMediaActionsComponent } from './track-media-actions.component';
import { TrackQualityComponent } from './track-quality.component';
import { TrackRenameDialogComponent, TrackRenameDialogData } from './track-rename-dialog.component';
import { BULK_REVIEW_MAX, trackReview } from './track-review';

export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;
/** A start or a rebuild comes with several events; the page is read once after them. */
export const LIBRARY_USAGE_RELOAD_MS = 1000;
/** An import analyses its tracks one event each: the list is read at most once per interval. */
export const LIBRARY_ANALYSIS_RELOAD_MS = 1000;

type Quality = NonNullable<TrackQuery['quality']>;
const QUALITIES: readonly Quality[] = ['ok', 'issues', 'unanalysed'];
const REVIEWED_FILTERS: readonly ReviewedFilter[] = ['true', 'false'];
const IN_PLAN_FILTERS: readonly InPlanFilter[] = ['true', 'false'];

interface PageRequest {
  query: TrackQuery;
  /** Set on the read of the last page after a page came back empty, so it happens once. */
  corrected?: boolean;
}

/**
 * The track library (docs/frontend-init-plan.md F5): search by title or artist, filters by
 * playlist, type, and quality, a play button on every row. The backend sorts and pages the whole
 * filtered list (F18); the page, its size, and the order are kept in the URL. Selected tracks,
 * on any page, can be analysed again or fixed (F10), deleted with one request (F17), renamed
 * with find and replace, or marked reviewed (F19). A row's title can be corrected in a dialog.
 * Each row shows whether the track is in use (F20): its next planned start, on air or queued,
 * and its playlists; the marks follow the air through the playout and plan events.
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
    MatTooltipModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    StationTimePipe,
    PageHeaderComponent,
    ArtistSelectComponent,
    OperationStatusComponent,
    PlayButtonComponent,
    LibraryStatsComponent,
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

    <app-library-stats [stats]="stats()" (filterChosen)="applyStatsFilter($event)" />

    <form class="list-filters" [formGroup]="filters" role="search">
      <mat-form-field>
        <mat-label>{{ 'library.filters.search' | translate }}</mat-label>
        <input #search matInput type="search" formControlName="q" />
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
      <app-artist-select label="library.filters.artist" [control]="filters.controls.artist_id" />
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
      <mat-form-field>
        <mat-label>{{ 'library.filters.reviewed' | translate }}</mat-label>
        <mat-select formControlName="reviewed">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (reviewed of reviewedFilters; track reviewed) {
            <mat-option [value]="reviewed">{{
              'library.reviewedFilter.' + reviewed | translate
            }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.inPlan' | translate }}</mat-label>
        <mat-select formControlName="in_plan">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (inPlan of inPlanFilters; track inPlan) {
            <mat-option [value]="inPlan">{{
              'library.inPlanFilter.' + inPlan | translate
            }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-checkbox class="filter-check" formControlName="without_playlist">
        {{ 'library.filters.withoutPlaylist' | translate }}
      </mat-checkbox>
      @if (active() > 0) {
        <button matButton type="button" class="clear-filters" (click)="clearFilters()">
          {{ 'library.filters.clear' | translate }}
        </button>
      }
    </form>

    @if (
      selectedTracks().length > 0 ||
      media.run.state() ||
      bulkDelete.running() ||
      bulkDelete.result() ||
      bulkDelete.error() ||
      review.running() ||
      review.error() ||
      review.notFound()
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
              [disabled]="tooManyForBulk() || busy()"
              (click)="deleteSelected()"
            >
              {{ 'library.bulkDelete.delete' | translate: { count: selectedTracks().length } }}
            </button>
          }
        </h2>
        @if (selectedTracks().length > 0) {
          <div class="selection-actions">
            <button
              matButton="outlined"
              type="button"
              [disabled]="busy() || tooManyForBulk()"
              (click)="renameSelected()"
            >
              {{ 'library.selection.rename' | translate: { count: selectedTracks().length } }}
            </button>
            <button
              matButton="outlined"
              type="button"
              [disabled]="busy() || tooManyForBulk()"
              (click)="reviewSelected(true)"
            >
              {{ 'library.selection.markReviewed' | translate: { count: selectedTracks().length } }}
            </button>
            <button
              matButton="outlined"
              type="button"
              [disabled]="busy() || tooManyForBulk()"
              (click)="reviewSelected(false)"
            >
              {{
                'library.selection.markUnreviewed' | translate: { count: selectedTracks().length }
              }}
            </button>
          </div>
        }
        @if (tooManyForBulk()) {
          <p class="muted">{{ 'library.bulkDelete.tooMany' | translate }}</p>
        }
        @if (review.running()) {
          <mat-progress-bar
            mode="indeterminate"
            [attr.aria-label]="'library.selection.reviewRunning' | translate"
          />
        }
        @if (review.error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (review.notFound(); as count) {
          <p class="muted" role="status">
            {{ 'library.selection.reviewNotFound' | translate: { count } }}
          </p>
        }
        <app-track-media-actions
          [tracks]="selectedTracks()"
          [running]="busy()"
          (request)="startMedia($event)"
        />
        @if (media.error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <app-operation-status [state]="media.run.state()" runningLabel="library.media.running" />
        @if (media.cueReset(); as reset) {
          <p class="muted" role="status">
            {{ 'library.media.cueReset' | translate: { count: reset.count, paths: reset.paths } }}
          </p>
        }
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

    <div class="load-slot">
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
    </div>
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
        [trackBy]="trackById"
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
            <button
              type="button"
              class="title-button"
              [attr.aria-label]="'library.rename.button' | translate: { title: track.title }"
              (click)="rename(track)"
            >
              {{ track.title }}
            </button>
            @if (track.playout_state; as state) {
              @let stateLabel = 'library.usage.' + state | translate;
              <span
                class="playout"
                [class.on-air]="state === 'on_air'"
                role="img"
                tabindex="0"
                [matTooltip]="stateLabel"
                [attr.aria-label]="stateLabel"
                >{{ state === 'on_air' ? '●' : '◷' }}</span
              >
            }
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
              {{ track.air_duration_ms ?? track.duration_ms | duration }}
              @if (isCut(track)) {
                @let cutLabel =
                  'library.usage.cut'
                    | translate
                      : {
                          air: (track.air_duration_ms | duration),
                          file: (track.duration_ms | duration),
                        };
                <span
                  class="cut"
                  role="img"
                  tabindex="0"
                  [matTooltip]="cutLabel"
                  [attr.aria-label]="cutLabel"
                  >✂</span
                >
              }
            } @else {
              <span class="badge warn">{{ 'library.noDuration' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="inPlan">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header="next_planned_at"
            [sortActionDescription]="
              'library.sort.by'
                | translate: { column: ('library.fields.next_planned_at' | translate) }
            "
          >
            {{ 'library.fields.next_planned_at' | translate }}
          </th>
          <td mat-cell *matCellDef="let track" class="numeric">
            @if (track.next_planned_at) {
              {{ track.next_planned_at | stationTime }}
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="playlists">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'library.fields.playlist_ids' | translate }}
          </th>
          <td mat-cell *matCellDef="let track" class="numeric">
            @if (track.playlist_ids.length > 0) {
              @let names = playlistNames(track);
              <span
                tabindex="0"
                [matTooltip]="names"
                [attr.aria-label]="
                  'library.usage.playlists'
                    | translate: { count: track.playlist_ids.length, names: names }
                "
                >{{ track.playlist_ids.length }}</span
              >
            } @else {
              <span class="muted">0</span>
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
        <ng-container matColumnDef="reviewed">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'library.sort.by' | translate: { column: ('library.fields.reviewed' | translate) }
            "
          >
            {{ 'library.fields.reviewed' | translate }}
          </th>
          <td mat-cell *matCellDef="let track">
            @if (track.reviewed_at) {
              @let reviewedLabel =
                'library.reviewedAt' | translate: { time: (track.reviewed_at | stationTime) };
              <span
                class="reviewed"
                role="img"
                tabindex="0"
                [matTooltip]="reviewedLabel"
                [attr.aria-label]="reviewedLabel"
                >✓</span
              >
            }
          </td>
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
    /* The space is kept when the bar is gone, or the table would move on every reload. In flow on
       purpose: an absolutely positioned bar widens the scrollable content. */
    .load-slot {
      height: 4px;
    }

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

    .selection-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
    }

    /* The title opens the rename dialog, so it is a button that reads as a link. */
    .title-button {
      padding: 0;
      border: 0;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      text-align: start;
      text-decoration: underline;
      cursor: pointer;
    }

    .title-button:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    .reviewed {
      color: var(--mat-sys-primary);
      font-weight: 700;
    }

    .playout,
    .cut {
      margin-left: 0.375rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .playout.on-air {
      color: var(--mat-sys-error);
    }

    .filter-check,
    .clear-filters {
      align-self: center;
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
  private readonly dialog = inject(MatDialog);
  /** The rows as read, so the track editor can open the next one (Save and Next). */
  private readonly cursor = inject(LibraryCursorService);

  /** Query parameter `quality`, as the import's "tracks with issues" link sets it. */
  readonly quality = input<string>();
  /** Query parameter `reviewed`, as the import's "Review the new tracks" link sets it. */
  readonly reviewed = input<string>();
  /** Query parameter `artist_id`, as the Artists page's track count link sets it. */
  readonly artist_id = input<string>();
  /** Query parameters of the usage filters (F20), named as the router passes them. */
  readonly in_plan = input<string>();
  readonly in_playlist = input<string>();
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
    'inPlan',
    'playlists',
    'format',
    'quality',
    'reviewed',
    'actions',
  ];
  protected readonly qualities = QUALITIES;
  protected readonly reviewedFilters = REVIEWED_FILTERS;
  protected readonly inPlanFilters = IN_PLAN_FILTERS;
  protected readonly pageSizes = LIBRARY_PAGE_SIZES;
  /** A reload then updates the rows that stay on the page instead of recreating them. */
  protected readonly trackById = (_index: number, track: Track): number => track.id;
  protected readonly playlists = catalogList(this.catalog.playlists());
  protected readonly types = catalogList(this.catalog.playlistTypes());

  protected readonly filters = new FormGroup({
    q: new FormControl(''),
    playlist_id: new FormControl<number | null>(null),
    artist_id: new FormControl<number | null>(null),
    type_id: new FormControl<number | null>(null),
    quality: new FormControl<Quality | null>(null),
    reviewed: new FormControl<ReviewedFilter | null>(null),
    in_plan: new FormControl<InPlanFilter | null>(null),
    without_playlist: new FormControl(false, { nonNullable: true }),
  });
  private readonly filtersVersion = controlVersion(signal(this.filters));
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('search');

  /** Filters in use; a search of only spaces is sent as no search, so it does not count. */
  protected readonly active = computed(() => {
    this.filtersVersion();
    const value = this.filters.getRawValue();
    return [
      value.q?.trim() || null,
      value.playlist_id,
      value.artist_id,
      value.type_id,
      value.quality,
      value.reviewed,
      value.in_plan,
      value.without_playlist || null,
    ].filter((item) => item !== null).length;
  });

  private readonly playlistNamesById = computed(
    () => new Map(this.playlists().items.map((playlist) => [playlist.id, playlist.name])),
  );

  protected readonly list = signal<LibraryListState>(DEFAULT_LIST_STATE);
  protected readonly rows = signal<readonly Track[]>([]);
  protected readonly total = signal(0);
  /** Set when a page arrives, not when it is asked for, so the announcement matches the rows. */
  protected readonly pageStatus = signal<TranslationParams | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Kept while the next figures load; null before the first answer and after a failed one. */
  protected readonly stats = signal<TrackStats | null>(null);

  /**
   * Selected tracks by ID, on any page: changing the page or the sort keeps them, a reload
   * refreshes the ones on the page it reads (new fixes, title), and a filter change clears them.
   * Deleted tracks are removed explicitly, since a track missing from one page may be on another.
   */
  protected readonly selected = signal<ReadonlyMap<number, Track>>(new Map());
  protected readonly selectedTracks = computed(() => [...this.selected().values()]);
  /** Rename and review take as many tracks as a delete; one check covers all three. */
  protected readonly tooManyForBulk = computed(
    () => this.selected().size > Math.min(BULK_DELETE_MAX, BULK_REVIEW_MAX, BULK_RENAME_MAX),
  );
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

  /** Tracks that no longer exist leave the selection; the others stay selected. */
  protected readonly review = trackReview((notFound) => {
    this.deselect(notFound);
    this.reload();
  });

  /** One request on the selection at a time. */
  protected readonly busy = computed(
    () => this.media.run.running() || this.bulkDelete.running() || this.review.running(),
  );

  private readonly pages = new Subject<PageRequest>();
  private readonly statsRequests = new Subject<TrackQuery>();
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
        this.cursor.set({
          query: request.query,
          offset,
          size: pageSize,
          total: page.total,
          trackIds: page.items.map((track) => track.id),
        });
        this.pageStatus.set({
          page: this.list().pageIndex + 1,
          pages: Math.max(1, Math.ceil(page.total / pageSize)),
          total: page.total,
        });
        this.refreshSelection();
      });

    this.statsRequests
      .pipe(
        switchMap((query) =>
          // The row is secondary: its failure shows dashes and leaves the table to work as usual.
          this.api.get('/api/tracks/stats', { query }).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((stats) => this.stats.set(stats));

    // Tracks imported, analysed, or fixed, here or elsewhere.
    const realtime = inject(RealtimeService);
    merge(
      realtime.on('import.completed'),
      realtime.on('analyse.completed'),
      realtime.on('transcode.completed'),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());

    // Each analysed track arrives as its own event while an import runs: the list is read at most
    // once per interval, first at once, and once more after the last event of a burst.
    realtime
      .on('track.analysed')
      .pipe(
        throttleTime(LIBRARY_ANALYSIS_RELOAD_MS, asyncScheduler, { leading: true, trailing: true }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.reload());

    // The event says which track is on air, so the mark moves without a request, for every source.
    realtime
      .on('playout.now_playing')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) =>
        this.patchRows((track) =>
          track.id === data.track_id
            ? { ...track, playout_state: 'on_air' }
            : this.withoutOnAir(track),
        ),
      );

    // Only the row of the ended track: a late end of the previous track must not clear the mark of
    // the track that has just started.
    realtime
      .on('playout.track_ended')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) =>
        this.patchRows((track) => (track.id === data.track_id ? this.withoutOnAir(track) : track)),
      );

    // A planned start changes the queued marks and In plan, which no event carries; an emergency
    // track and the end of a track change neither. The figures depend on the plan only through the
    // in_plan filter, so a planned start alone leaves them unless that filter is on.
    let planChanged = false;
    merge(
      realtime.on('playout.now_playing').pipe(
        filter(({ data }) => data.source === 'plan'),
        map(() => false),
      ),
      merge(
        realtime.on('track_plan.completed'),
        realtime.on('clock_build.completed'),
        realtime.on('reschedule.completed'),
        realtime.on('missed_items.completed'),
      ).pipe(map(() => true)),
    )
      .pipe(
        tap((plan) => (planChanged ||= plan)),
        debounceTime(LIBRARY_USAGE_RELOAD_MS),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (planChanged || this.filterQuery.in_plan !== undefined) {
          this.reload();
        } else {
          this.readPage();
        }
        planChanged = false;
      });
  }

  ngOnInit(): void {
    // Router inputs are set before the first change detection, not in the constructor.
    const quality = this.quality();
    if (QUALITIES.includes(quality as Quality)) {
      this.filters.controls.quality.setValue(quality as Quality, { emitEvent: false });
    }
    this.filters.controls.artist_id.setValue(readArtistFilter(this.artist_id()), {
      emitEvent: false,
    });
    this.filters.controls.reviewed.setValue(readReviewedFilter(this.reviewed()), {
      emitEvent: false,
    });
    this.filters.controls.in_plan.setValue(readInPlanFilter(this.in_plan()), { emitEvent: false });
    this.filters.controls.without_playlist.setValue(readWithoutPlaylist(this.in_playlist()), {
      emitEvent: false,
    });
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
          artist_id: value.artist_id ?? undefined,
          type_id: value.type_id ?? undefined,
          quality: value.quality ?? undefined,
          reviewed: value.reviewed ?? undefined,
          in_plan: value.in_plan ?? undefined,
          in_playlist: value.without_playlist ? ('false' as const) : undefined,
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
    this.readPage();
  }

  /** A new page size comes with the paginator's page that holds the first row of the old one. */
  protected onPage(event: PageEvent): void {
    this.setList({ ...this.list(), pageIndex: event.pageIndex, pageSize: event.pageSize });
    this.readPage();
  }

  /** Sets the one control; the filter flow does the rest (page 1, selection, URL). */
  protected applyStatsFilter(chosen: LibraryStatsFilter): void {
    if (chosen === 'reviewed') {
      this.filters.controls.reviewed.setValue('true');
    } else {
      this.filters.controls.quality.setValue(chosen);
    }
  }

  /** One reset, so the filter flow sends one request and not one per control. */
  protected clearFilters(): void {
    this.filters.reset({ q: '' });
    // The button is about to disappear, and focus would be lost with it.
    this.searchInput().nativeElement.focus();
  }

  protected select(track: Track, checked: boolean): void {
    this.clearResults();
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
    this.clearResults();
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
    this.clearResults();
    this.selected.set(new Map());
  }

  private clearResults(): void {
    this.bulkDelete.clear();
    this.review.clear();
  }

  protected startMedia(request: MediaRequest): void {
    this.clearResults();
    this.media.start(request);
  }

  protected reviewSelected(reviewed: boolean): void {
    this.clearResults();
    this.review.start(
      this.selectedTracks().map((track) => track.id),
      reviewed,
    );
  }

  protected renameSelected(): void {
    this.clearResults();
    this.dialog
      .open<TrackBulkRenameDialogComponent, TrackBulkRenameDialogData, TrackBulkRenameDialogResult>(
        TrackBulkRenameDialogComponent,
        { data: { tracks: this.selectedTracks() }, width: '40rem', maxWidth: 'calc(100vw - 2rem)' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        // Escape after an apply closes without a result, so the page is read again either way.
        if (result) {
          this.deselect(result.notFound);
        }
        this.reload();
      });
  }

  protected rename(track: Track): void {
    this.dialog
      .open<TrackRenameDialogComponent, TrackRenameDialogData, boolean>(
        TrackRenameDialogComponent,
        { data: { track }, width: '32rem', maxWidth: 'calc(100vw - 2rem)' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result !== false) {
          this.reload();
        }
      });
  }

  protected deleteSelected(): void {
    const ids = this.selectedTracks().map((track) => track.id);
    this.clearResults();
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

  /** The tracks or the filters changed: reads the current page and the figures again. */
  protected reload(): void {
    this.readPage();
    this.statsRequests.next(this.filterQuery);
  }

  /** A new page or order alone: the figures describe the whole filtered list, so they stay. */
  private readPage(): void {
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
      // Written with the page, so a filter chosen here does not lose to the one in the URL.
      queryParams: {
        ...listStateParams(state),
        artist_id: this.filters.value.artist_id ?? null,
        quality: this.filters.value.quality ?? null,
        reviewed: this.filters.value.reviewed ?? null,
        in_plan: this.filters.value.in_plan ?? null,
        in_playlist: this.filters.value.without_playlist ? 'false' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Keeps the current array when no row changed, so an event for another page renders nothing. */
  private patchRows(patch: (track: Track) => Track): void {
    const rows = this.rows();
    const patched = rows.map(patch);
    if (patched.some((track, index) => track !== rows[index])) {
      this.rows.set(patched);
    }
  }

  private withoutOnAir(track: Track): Track {
    return track.playout_state === 'on_air' ? { ...track, playout_state: undefined } : track;
  }

  /** A cut track plays shorter than its file. */
  protected isCut(track: Track): boolean {
    return track.air_duration_ms !== undefined && track.air_duration_ms !== track.duration_ms;
  }

  protected playlistNames(track: Track): string {
    const names = this.playlistNamesById();
    return track.playlist_ids.map((id) => names.get(id) ?? `#${id}`).join(', ');
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

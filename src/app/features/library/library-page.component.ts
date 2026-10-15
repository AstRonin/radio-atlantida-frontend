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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  merge,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { errorMessage } from '../../core/api/problem-message';
import { ApiClient } from '../../core/api/api-client.service';
import { CatalogService, TrackQuery, catalogList } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import type { Track } from './track-form';
import { trackMedia } from './track-media';
import { TrackMediaActionsComponent } from './track-media-actions.component';
import { TrackQualityComponent } from './track-quality.component';

export const LIBRARY_PAGE_SIZE = 100;
export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;

type Quality = NonNullable<TrackQuery['quality']>;
const QUALITIES: readonly Quality[] = ['ok', 'issues', 'unanalysed'];

interface PageRequest {
  query: TrackQuery;
  cursor?: string;
}

/**
 * The track library (docs/frontend-init-plan.md F5): search by title or artist, filters by
 * playlist, type, and quality, a play button on every row. Pages are read with the backend's
 * cursor, a hundred tracks at a time. Selected tracks can be analysed again or fixed (F10).
 */
@Component({
  selector: 'app-library-page',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    PageHeaderComponent,
    OperationStatusComponent,
    PlayButtonComponent,
    TrackMediaActionsComponent,
    TrackQualityComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="library.title" helpPage="help.library">
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

    @if (selectedTracks().length > 0 || media.run.state()) {
      <section class="page-section selection" aria-labelledby="selection-heading">
        <h2 id="selection-heading" class="section-title">
          {{ 'library.media.selected' | translate: { count: selectedTracks().length } }}
          @if (selectedTracks().length > 0) {
            <button matButton type="button" (click)="clearSelection()">
              {{ 'library.media.clearSelection' | translate }}
            </button>
          }
        </h2>
        <app-track-media-actions
          [tracks]="selectedTracks()"
          [running]="media.run.running()"
          (request)="media.start($event)"
        />
        @if (media.error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <app-operation-status [state]="media.run.state()" runningLabel="library.media.running" />
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
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="select">
          <th mat-header-cell *matHeaderCellDef>
            <mat-checkbox
              [checked]="allSelected()"
              [indeterminate]="selectedTracks().length > 0 && !allSelected()"
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
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.title' | translate }}</th>
          <td mat-cell *matCellDef="let track">
            <a [routerLink]="['/library', track.id]">{{ track.title }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="artist">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.artist_id' | translate }}</th>
          <td mat-cell *matCellDef="let track">{{ track.artist?.name }}</td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.type_id' | translate }}</th>
          <td mat-cell *matCellDef="let track">
            <span class="badge">{{ track.type.name }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="duration">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.duration_ms' | translate }}</th>
          <td mat-cell *matCellDef="let track" class="numeric">
            @if (track.duration_ms) {
              {{ track.duration_ms | duration }}
            } @else {
              <span class="badge warn">{{ 'library.noDuration' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="format">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.format' | translate }}</th>
          <td mat-cell *matCellDef="let track">{{ track.format }}</td>
        </ng-container>
        <ng-container matColumnDef="quality">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.quality_ok' | translate }}</th>
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

    @if (nextCursor()) {
      <div class="form-actions">
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'common.loadMore' | translate }}
        </button>
      </div>
    }
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
  `,
})
export default class LibraryPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  /** Query parameter `quality`, as the import's "tracks with issues" link sets it. */
  readonly quality = input<string>();

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
  protected readonly playlists = catalogList(this.catalog.playlists());
  protected readonly types = catalogList(this.catalog.playlistTypes());

  protected readonly filters = new FormGroup({
    q: new FormControl(''),
    playlist_id: new FormControl<number | null>(null),
    type_id: new FormControl<number | null>(null),
    quality: new FormControl<Quality | null>(null),
  });

  protected readonly rows = signal<readonly Track[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /**
   * Selected tracks by ID, always a subset of the loaded rows: a reload keeps the ones it reads
   * again, with their new fixes, and drops the rest; a filter change clears it.
   */
  protected readonly selected = signal<ReadonlyMap<number, Track>>(new Map());
  protected readonly selectedTracks = computed(() => [...this.selected().values()]);
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((track) => this.selected().has(track.id)),
  );

  /** The tracks changed, so their rows and fixes are read again. */
  protected readonly media = trackMedia((state) => {
    if (state.status === 'completed') {
      this.clearSelection();
    }
    this.reload();
  });

  private readonly pages = new Subject<PageRequest>();
  private query: TrackQuery = { limit: LIBRARY_PAGE_SIZE };

  constructor() {
    this.pages
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.loadError.set(null);
          return this.api
            .get('/api/tracks', { query: { ...request.query, cursor: request.cursor } })
            .pipe(
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
        this.rows.update((rows) => (request.cursor ? [...rows, ...page.items] : page.items));
        this.nextCursor.set(page.next_cursor ?? null);
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
          limit: LIBRARY_PAGE_SIZE,
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((query) => {
        this.clearSelection();
        this.query = query;
        this.pages.next({ query });
      });
  }

  protected select(track: Track, checked: boolean): void {
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
    const rows = new Map(this.rows().map((track) => [track.id, track]));
    this.selected.update(
      (selected) =>
        new Map(
          [...selected.keys()].flatMap((id) => {
            const track = rows.get(id);
            return track ? [[id, track] as const] : [];
          }),
        ),
    );
  }

  protected clearSelection(): void {
    this.selected.set(new Map());
  }

  protected reload(): void {
    this.pages.next({ query: this.query });
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.pages.next({ query: this.query, cursor });
    }
  }

  protected remove(track: Track): void {
    this.confirm
      .confirmDelete({
        name: track.title,
        action: () => this.api.delete('/api/tracks/{id}', { path: { id: track.id } }),
      })
      .subscribe((deleted) => deleted && this.reload());
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  Subject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  skip,
  startWith,
  switchMap,
} from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { CatalogService } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { controlErrorMessage, controlVersion } from '../../shared/forms/field-errors';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import {
  TrackFilterQuery,
  TrackFiltersComponent,
  trackFilterForm,
  trackFilterQuery,
} from '../../shared/pickers/track-filters.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';

type Track = ApiSchema<'Track'>;

export const MEMBER_SEARCH_DEBOUNCE_MS = 300;
export const MEMBER_SEARCH_PAGE_SIZE = 25;
/** Rows of the member list drawn at once; the filter finds the others. */
export const MEMBERS_SHOWN = 200;

interface SearchRequest extends TrackFilterQuery {
  q: string;
  cursor?: string;
}

/**
 * Whether a member matches the text and the filters. The members are all in this playlist, so
 * the playlist filter asks for a track also in another one. A track not loaded yet matches only
 * when nothing is filtered.
 */
function matchesMember(track: Track | null, text: string, query: TrackFilterQuery): boolean {
  if (!track) {
    return !text && Object.values(query).every((value) => value === undefined);
  }
  return (
    (!text ||
      track.title.toLocaleLowerCase().includes(text) ||
      (track.artist?.name.toLocaleLowerCase().includes(text) ?? false)) &&
    (query.type_id === undefined || track.type.id === query.type_id) &&
    (query.artist_id === undefined || track.artist?.id === query.artist_id) &&
    (query.playlist_id === undefined || track.playlist_ids.includes(query.playlist_id)) &&
    (query.reviewed === undefined || (query.reviewed === 'true') === Boolean(track.reviewed_at))
  );
}

/**
 * The tracks of a playlist (design §4): a set, so no order is shown or stored. The value of the
 * control is the list of track IDs; `members` are the tracks of the stored playlist, so their rows
 * show without one request per track. Tracks are added from a search over the library, narrowed
 * by `app-track-filters`.
 */
@Component({
  selector: 'app-playlist-tracks',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslatePipe,
    DurationPipe,
    FieldHintComponent,
    PlayButtonComponent,
    TrackFiltersComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="box">
      <legend>
        {{ 'playlists.tracks.label' | translate: { count: chosenIds().length } }}
        <app-field-hint page="help.playlists" field="track_ids" />
      </legend>
      <p class="muted">{{ 'playlists.tracks.poolNote' | translate }}</p>

      <app-track-filters [form]="memberFilters" [withoutPlaylistFilter]="false">
        <mat-form-field class="wide">
          <mat-label>{{ 'playlists.tracks.filter' | translate }}</mat-label>
          <input matInput type="search" [value]="filter()" (input)="onFilter($event)" />
        </mat-form-field>
      </app-track-filters>

      <ul class="rows" [attr.aria-label]="'playlists.tracks.members' | translate">
        @for (row of shownMembers(); track row.id) {
          <li class="row">
            @if (row.track; as track) {
              <app-play-button [track]="track" />
              <span class="title">{{ track.title }}</span>
              <span class="muted ellipsis">{{ track.artist?.name }}</span>
              <span class="badge">{{ track.type.name }}</span>
              <span class="muted numeric">{{ track.duration_ms | duration }}</span>
            } @else {
              <span></span>
              <span class="title">{{
                'pickers.tracks.loadingTrack' | translate: { id: row.id }
              }}</span>
              <span></span>
              <span></span>
              <span></span>
            }
            <button
              matButton
              type="button"
              [attr.aria-label]="
                'pickers.tracks.remove' | translate: { title: row.track?.title ?? row.id }
              "
              (click)="remove(row.id)"
            >
              {{ 'playlists.tracks.remove' | translate }}
            </button>
          </li>
        } @empty {
          <li class="muted empty">{{ 'playlists.tracks.none' | translate }}</li>
        }
      </ul>
      @if (hiddenCount() > 0) {
        <p class="muted">{{ 'playlists.tracks.more' | translate: { count: hiddenCount() } }}</p>
      }
      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
    </fieldset>

    <fieldset class="box">
      <legend>{{ 'playlists.tracks.addLabel' | translate }}</legend>
      <app-track-filters [form]="filters">
        <mat-form-field class="wide">
          <mat-label>{{ 'pickers.tracks.search' | translate }}</mat-label>
          <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
        </mat-form-field>
      </app-track-filters>
      @if (searching()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (searchError(); as message) {
        <p class="load-error" role="alert">{{ message }}</p>
      }
      <ul class="rows" [attr.aria-label]="'pickers.tracks.results' | translate">
        @for (track of results(); track track.id) {
          <li class="row">
            <app-play-button [track]="track" />
            <span class="title">{{ track.title }}</span>
            <span class="muted ellipsis">{{ track.artist?.name }}</span>
            <span class="badge">{{ track.type.name }}</span>
            <span class="muted numeric">{{ track.duration_ms | duration }}</span>
            @if (isChosen(track.id)) {
              <span class="badge">{{ 'playlists.tracks.inPlaylist' | translate }}</span>
            } @else {
              <button
                matButton
                type="button"
                [attr.aria-label]="'playlists.tracks.addOne' | translate: { title: track.title }"
                (click)="add(track)"
              >
                {{ 'playlists.tracks.add' | translate }}
              </button>
            }
          </li>
        } @empty {
          @if (!searching() && !searchError()) {
            <li class="muted empty">{{ 'pickers.noMatches' | translate }}</li>
          }
        }
      </ul>
      @if (nextCursor()) {
        <button matButton type="button" [disabled]="searching()" (click)="loadMore()">
          {{ 'pickers.loadMore' | translate }}
        </button>
      }
    </fieldset>
  `,
  styles: `
    .box {
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }

    legend {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
      padding: 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .wide {
      width: 100%;
    }

    .rows {
      max-height: 24rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 2fr) minmax(0, 1fr) auto auto auto;
      gap: 0.5rem;
      align-items: center;
      min-height: 2.5rem;
    }

    .row + .row {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .title,
    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .numeric {
      font-variant-numeric: tabular-nums;
    }

    .empty {
      padding: 0.5rem 0;
    }
  `,
})
export class PlaylistTracksComponent {
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  /** `track_ids` of the playlist form. */
  readonly control = input.required<FormControl<number[] | null>>();
  /** The stored tracks of the playlist, for their rows. */
  readonly members = input<readonly Track[]>([]);

  protected readonly error = controlErrorMessage(this.control);
  protected readonly filter = signal('');
  protected readonly search = signal('');
  protected readonly results = signal<readonly Track[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);

  private readonly version = controlVersion(this.control);
  private readonly known = signal<ReadonlyMap<number, Track>>(new Map());
  private readonly searches = new Subject<SearchRequest>();
  private query: Omit<SearchRequest, 'cursor'> = { q: '' };

  protected readonly filters = trackFilterForm();
  /** The filters of the members; the library search above has its own. */
  protected readonly memberFilters = trackFilterForm();
  private readonly memberQuery = toSignal(trackFilterQuery(this.memberFilters), {
    requireSync: true,
  });

  protected readonly chosenIds = computed(() => {
    this.version();
    return this.control().value ?? [];
  });

  /** Members sorted by title, as the library lists them; the set itself has no order. */
  private readonly memberRows = computed(() => {
    const known = this.known();
    const text = this.filter().trim().toLocaleLowerCase();
    const query = this.memberQuery();
    return this.chosenIds()
      .map((id) => ({ id, track: known.get(id) ?? null }))
      .filter(({ track }) => matchesMember(track, text, query))
      .sort((a, b) => (a.track?.title ?? '').localeCompare(b.track?.title ?? ''));
  });
  protected readonly shownMembers = computed(() => this.memberRows().slice(0, MEMBERS_SHOWN));
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.memberRows().length - MEMBERS_SHOWN),
  );

  constructor() {
    effect(() => {
      const members = this.members();
      untracked(() => this.remember(members));
    });

    this.searches
      .pipe(
        switchMap((request) => {
          this.searching.set(true);
          this.searchError.set(null);
          return this.catalog
            .tracks({
              ...request,
              q: request.q || undefined,
              cursor: request.cursor,
              limit: MEMBER_SEARCH_PAGE_SIZE,
            })
            .pipe(
              map((page) => ({ request, page, error: null as unknown })),
              catchError((error: unknown) => of({ request, page: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ request, page, error }) => {
        this.searching.set(false);
        if (!page) {
          this.searchError.set(errorMessage(error, this.i18n));
          return;
        }
        this.results.update((rows) => (request.cursor ? [...rows, ...page.items] : page.items));
        this.nextCursor.set(page.next_cursor ?? null);
      });

    const search = toObservable(this.search).pipe(
      map((text) => text.trim()),
      skip(1),
      debounceTime(MEMBER_SEARCH_DEBOUNCE_MS),
      startWith(''),
      distinctUntilChanged(),
    );
    combineLatest([search, trackFilterQuery(this.filters)])
      .pipe(takeUntilDestroyed())
      .subscribe(([q, filters]) => {
        this.query = { q, ...filters };
        this.searches.next(this.query);
      });
  }

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.searches.next({ ...this.query, cursor });
    }
  }

  protected isChosen(id: number): boolean {
    return this.chosenIds().includes(id);
  }

  protected add(track: Track): void {
    this.remember([track]);
    this.update([...this.chosenIds(), track.id]);
  }

  protected remove(id: number): void {
    this.update(this.chosenIds().filter((item) => item !== id));
  }

  private update(ids: number[]): void {
    const control = this.control();
    control.setValue(ids);
    control.markAsDirty();
    control.markAsTouched();
  }

  private remember(tracks: readonly Track[]): void {
    this.known.update((known) => {
      const next = new Map(known);
      for (const track of tracks) {
        next.set(track.id, track);
      }
      return next;
    });
  }
}

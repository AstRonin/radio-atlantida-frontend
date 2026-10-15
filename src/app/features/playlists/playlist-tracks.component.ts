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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  Subject,
  catchError,
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
import { PlayButtonComponent } from '../../shared/ui/play-button.component';

type Track = ApiSchema<'Track'>;

export const MEMBER_SEARCH_DEBOUNCE_MS = 300;
export const MEMBER_SEARCH_PAGE_SIZE = 25;
/** Rows of the member list drawn at once; the filter finds the others. */
export const MEMBERS_SHOWN = 200;

interface SearchRequest {
  q: string;
  cursor?: string;
}

/**
 * The tracks of a playlist (design §4): a set, so no order is shown or stored. The value of the
 * control is the list of track IDs; `members` are the tracks of the stored playlist, so their rows
 * show without one request per track. Tracks are added from a search over the library.
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="box">
      <legend>
        {{ 'playlists.tracks.label' | translate: { count: chosenIds().length } }}
        <app-field-hint page="help.playlists" field="track_ids" />
      </legend>
      <p class="muted">{{ 'playlists.tracks.poolNote' | translate }}</p>

      <mat-form-field class="wide">
        <mat-label>{{ 'playlists.tracks.filter' | translate }}</mat-label>
        <input matInput type="search" [value]="filter()" (input)="onFilter($event)" />
      </mat-form-field>

      <ul class="rows" [attr.aria-label]="'playlists.tracks.members' | translate">
        @for (row of shownMembers(); track row.id) {
          <li class="row">
            @if (row.track; as track) {
              <app-play-button [track]="track" />
              <span class="title">{{ track.title }}</span>
              <span class="muted ellipsis">{{ track.artist?.name }}</span>
              <span class="muted numeric">{{ track.duration_ms | duration }}</span>
            } @else {
              <span></span>
              <span class="title">{{
                'pickers.tracks.loadingTrack' | translate: { id: row.id }
              }}</span>
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
      <mat-form-field class="wide">
        <mat-label>{{ 'pickers.tracks.search' | translate }}</mat-label>
        <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
      </mat-form-field>
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
      grid-template-columns: auto minmax(0, 2fr) minmax(0, 1fr) auto auto;
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
  private query = '';

  protected readonly chosenIds = computed(() => {
    this.version();
    return this.control().value ?? [];
  });

  /** Members sorted by title, as the library lists them; the set itself has no order. */
  private readonly memberRows = computed(() => {
    const known = this.known();
    const text = this.filter().trim().toLocaleLowerCase();
    return this.chosenIds()
      .map((id) => ({ id, track: known.get(id) ?? null }))
      .filter(
        ({ track }) =>
          !text ||
          (track !== null &&
            (track.title.toLocaleLowerCase().includes(text) ||
              (track.artist?.name.toLocaleLowerCase().includes(text) ?? false))),
      )
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

    toObservable(this.search)
      .pipe(
        map((text) => text.trim()),
        skip(1),
        debounceTime(MEMBER_SEARCH_DEBOUNCE_MS),
        startWith(''),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((q) => {
        this.query = q;
        this.searches.next({ q });
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
      this.searches.next({ q: this.query, cursor });
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

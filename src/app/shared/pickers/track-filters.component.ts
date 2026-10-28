import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Observable, distinctUntilChanged, map, startWith } from 'rxjs';
import type { TrackQuery } from '../../core/catalog/catalog.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlVersion } from '../forms/field-errors';
import { PlaylistTypeSelectComponent } from '../forms/playlist-type-select.component';
import { ArtistSelectComponent } from './artist-select.component';
import { PlaylistSelectComponent } from './playlist-select.component';

type ReviewedFilter = NonNullable<TrackQuery['reviewed']>;

const REVIEWED_FILTERS: readonly ReviewedFilter[] = ['true', 'false'];

/** The filters of a track search; the names are the `GET /api/tracks` parameters. */
export type TrackFilterForm = FormGroup<{
  type_id: FormControl<number | null>;
  playlist_id: FormControl<number | null>;
  artist_id: FormControl<number | null>;
  reviewed: FormControl<ReviewedFilter | null>;
  without_playlist: FormControl<boolean>;
}>;

export type TrackFilterQuery = Pick<
  TrackQuery,
  'type_id' | 'playlist_id' | 'artist_id' | 'reviewed' | 'in_playlist'
>;

export function trackFilterForm(): TrackFilterForm {
  return new FormGroup({
    type_id: new FormControl<number | null>(null),
    playlist_id: new FormControl<number | null>(null),
    artist_id: new FormControl<number | null>(null),
    reviewed: new FormControl<ReviewedFilter | null>(null),
    without_playlist: new FormControl(false, { nonNullable: true }),
  });
}

function toQuery(form: TrackFilterForm): TrackFilterQuery {
  const value = form.getRawValue();
  return {
    type_id: value.type_id ?? undefined,
    playlist_id: value.playlist_id ?? undefined,
    artist_id: value.artist_id ?? undefined,
    reviewed: value.reviewed ?? undefined,
    in_playlist: value.without_playlist ? 'false' : undefined,
  };
}

/** The query parameters of the filters, now and after every change that alters them. */
export function trackFilterQuery(form: TrackFilterForm): Observable<TrackFilterQuery> {
  return form.valueChanges.pipe(
    map(() => toQuery(form)),
    startWith(toQuery(form)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  );
}

/**
 * Filters of a track search next to its text field (projected as content): type, playlist,
 * artist, reviewed mark, and tracks in no playlist. With thousands of tracks a search alone is not
 * enough. They are folded behind a button, and their lists are read only when they are shown.
 */
@Component({
  selector: 'app-track-filters',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    PlaylistTypeSelectComponent,
    PlaylistSelectComponent,
    ArtistSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search-row">
      <div class="search"><ng-content /></div>
      <button
        matButton
        type="button"
        class="filters-toggle"
        [attr.aria-expanded]="shown()"
        [attr.aria-controls]="id"
        (click)="shown.set(!shown())"
      >
        @if (active() > 0) {
          {{ 'pickers.tracks.filtersActive' | translate: { count: active() } }}
        } @else {
          {{ 'pickers.tracks.filters' | translate }}
        }
      </button>
    </div>

    @if (shown()) {
      <div class="filters" [id]="id">
        @if (!typeFixed()) {
          <app-playlist-type-select
            label="pickers.tracks.filterType"
            noneLabel="pickers.tracks.anyType"
            [control]="form().controls.type_id"
          />
        }
        <app-playlist-select
          label="pickers.tracks.filterPlaylist"
          noneLabel="pickers.tracks.anyPlaylist"
          [control]="form().controls.playlist_id"
        />
        <app-artist-select
          label="pickers.tracks.filterArtist"
          [control]="form().controls.artist_id"
        />
        <mat-form-field>
          <mat-label>{{ 'pickers.tracks.filterReviewed' | translate }}</mat-label>
          <mat-select [formControl]="form().controls.reviewed">
            <mat-option [value]="null">{{ 'pickers.tracks.anyReviewed' | translate }}</mat-option>
            @for (reviewed of reviewedFilters; track reviewed) {
              <mat-option [value]="reviewed">{{
                'pickers.tracks.reviewed.' + reviewed | translate
              }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (withoutPlaylistFilter()) {
          <mat-checkbox class="check" [formControl]="form().controls.without_playlist">
            {{ 'pickers.tracks.withoutPlaylist' | translate }}
          </mat-checkbox>
        }
        @if (active() > 0) {
          <button matButton type="button" class="clear-filters" (click)="clear()">
            {{ 'pickers.tracks.clearFilters' | translate }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .search-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-top: 0.5rem;
    }

    .search {
      flex: 1;
      min-width: 0;
    }

    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 0 0.75rem;
      align-items: start;
    }

    .check {
      margin-top: 0.5rem;
    }

    .clear-filters {
      justify-self: start;
      margin-top: 0.5rem;
    }
  `,
})
export class TrackFiltersComponent {
  private static nextId = 0;

  readonly form = input.required<TrackFilterForm>();
  /** The search is limited to one type by its host, so the type filter is hidden. */
  readonly typeFixed = input(false);
  /** Hidden where every track already belongs to one playlist, so the checkbox means nothing. */
  readonly withoutPlaylistFilter = input(true);

  protected readonly id = `track-filters-${TrackFiltersComponent.nextId++}`;
  protected readonly shown = signal(false);
  protected readonly reviewedFilters = REVIEWED_FILTERS;
  private readonly version = controlVersion(this.form);

  /** Filters in use; a hidden type filter does not count. */
  protected readonly active = computed(() => {
    this.version();
    const value = this.form().getRawValue();
    return [
      this.typeFixed() ? null : value.type_id,
      value.playlist_id,
      value.artist_id,
      value.reviewed,
      value.without_playlist || null,
    ].filter((item) => item !== null).length;
  });

  protected clear(): void {
    this.form().reset();
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { problemMessage } from '../../core/api/problem-message';
import { CatalogService } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { controlErrorMessage, controlVersion } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';
import { PlayButtonComponent } from '../ui/play-button.component';

type Track = ApiSchema<'Track'>;

export const TRACK_SEARCH_DEBOUNCE_MS = 300;
export const TRACK_PAGE_SIZE = 25;

interface PageRequest {
  q: string;
  typeId: number | null;
  cursor?: string;
}

/**
 * Searchable track picker (docs/frontend-init-plan.md F4): rows show title, artist, and duration,
 * each with a play button for the preview (design §6.6). The value is a list of track IDs: one at
 * most in single mode, and in the order of choice when `ordered`. The search matches title or
 * artist name on the backend, limited to tracks of one type when `typeId` is set.
 */
@Component({
  selector: 'app-track-picker',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
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
    <fieldset class="picker" [disabled]="control().disabled">
      <legend>
        {{ label() | translate }}
        @if (hintPage(); as page) {
          <app-field-hint [page]="page" [field]="hintField() ?? ''" />
        }
      </legend>

      @if (selected().length > 0) {
        <h3 class="heading">{{ 'pickers.tracks.selected' | translate }}</h3>
        <ol class="rows selected">
          @for (row of selected(); track row.id; let first = $first; let last = $last) {
            <li class="row">
              @if (row.track; as track) {
                <app-play-button [track]="track" />
                <span class="title">{{ track.title }}</span>
                <span class="artist">{{ track.artist?.name }}</span>
                <span class="duration">{{ track.duration_ms | duration }}</span>
              } @else {
                <span class="title">{{
                  'pickers.tracks.loadingTrack' | translate: { id: row.id }
                }}</span>
              }
              @if (ordered()) {
                <button
                  matIconButton
                  type="button"
                  [disabled]="first"
                  [attr.aria-label]="
                    'pickers.tracks.moveUp' | translate: { title: row.track?.title ?? row.id }
                  "
                  (click)="move(row.id, -1)"
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  matIconButton
                  type="button"
                  [disabled]="last"
                  [attr.aria-label]="
                    'pickers.tracks.moveDown' | translate: { title: row.track?.title ?? row.id }
                  "
                  (click)="move(row.id, 1)"
                >
                  <span aria-hidden="true">↓</span>
                </button>
              }
              <button
                matIconButton
                type="button"
                [attr.aria-label]="
                  'pickers.tracks.remove' | translate: { title: row.track?.title ?? row.id }
                "
                (click)="setChosen(row.id, false)"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          }
        </ol>
      }

      <mat-form-field class="search">
        <mat-label>{{ 'pickers.tracks.search' | translate }}</mat-label>
        <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
      </mat-form-field>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'pickers.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">{{ message }}</p>
      }

      <ul class="rows results" [attr.aria-label]="'pickers.tracks.results' | translate">
        @for (track of results(); track track.id) {
          <li class="row">
            <mat-checkbox
              [checked]="isChosen(track.id)"
              [disabled]="control().disabled"
              (change)="setChosen(track.id, $event.checked)"
            >
              <span class="title">{{ track.title }}</span>
            </mat-checkbox>
            <span class="artist">{{ track.artist?.name }}</span>
            <span class="duration">{{ track.duration_ms | duration }}</span>
            <app-play-button [track]="track" />
          </li>
        } @empty {
          @if (!loading() && !loadError()) {
            <li class="empty">{{ 'pickers.noMatches' | translate }}</li>
          }
        }
      </ul>

      @if (nextCursor()) {
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'pickers.loadMore' | translate }}
        </button>
      }

      @if (error(); as message) {
        <p class="field-error" role="alert">{{ message }}</p>
      }
    </fieldset>
  `,
  styles: `
    .picker {
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
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .heading {
      margin: 0.25rem 0;
      font: var(--mat-sys-title-small);
    }

    .search {
      width: 100%;
      margin-top: 0.5rem;
    }

    .rows {
      max-height: 18rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .selected {
      max-height: 12rem;
      margin-bottom: 0.5rem;
    }

    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 2fr) minmax(0, 1fr) auto auto auto auto;
      gap: 0.5rem;
      align-items: center;
      min-height: 2.5rem;
    }

    .results .row {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto auto;
    }

    .row + .row {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .title,
    .artist {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .artist,
    .duration,
    .empty {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .duration {
      font-variant-numeric: tabular-nums;
    }

    .empty {
      padding: 0.5rem 0;
    }

    .load-error,
    .field-error {
      margin: 0.25rem 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class TrackPickerComponent {
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  readonly control = input.required<FormControl<number[] | null>>();
  readonly label = input('pickers.tracks.label');
  /** One track at most; choosing another replaces it. */
  readonly multiple = input(true);
  /** Shows move up and down buttons; the order of the value is significant. */
  readonly ordered = input(false);
  /** Only tracks of this type (`type_id`), for example news for a one-time insert; null for all. */
  readonly typeId = input<number | null>(null);
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
  protected readonly search = signal('');
  protected readonly results = signal<readonly Track[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly version = controlVersion(this.control);
  private readonly known = signal<ReadonlyMap<number, Track>>(new Map());
  private readonly requested = new Set<number>();
  private readonly pages = new Subject<PageRequest>();
  private query: Omit<PageRequest, 'cursor'> = { q: '', typeId: null };

  protected readonly chosenIds = computed(() => {
    this.version();
    return this.control().value ?? [];
  });

  protected readonly selected = computed(() =>
    this.chosenIds().map((id) => ({ id, track: this.known().get(id) ?? null })),
  );

  constructor() {
    this.pages
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.loadError.set(null);
          return this.catalog
            .tracks({
              q: request.q || undefined,
              type_id: request.typeId ?? undefined,
              cursor: request.cursor,
              limit: TRACK_PAGE_SIZE,
            })
            .pipe(
              map((page) => ({ request, page, error: null })),
              catchError((error: unknown) => of({ request, page: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ request, page, error }) => {
        this.loading.set(false);
        if (!page) {
          this.loadError.set(this.describe(error));
          return;
        }
        this.remember(page.items);
        this.results.update((rows) => (request.cursor ? [...rows, ...page.items] : page.items));
        this.nextCursor.set(page.next_cursor ?? null);
      });

    const search = toObservable(this.search).pipe(
      map((text) => text.trim()),
      skip(1),
      debounceTime(TRACK_SEARCH_DEBOUNCE_MS),
      startWith(''),
      distinctUntilChanged(),
    );
    combineLatest([search, toObservable(this.typeId).pipe(distinctUntilChanged())])
      .pipe(takeUntilDestroyed())
      .subscribe(([q, typeId]) => {
        this.query = { q, typeId };
        this.pages.next(this.query);
      });

    // A form that starts with chosen tracks knows only their IDs; read the ones not seen yet.
    effect(() => {
      for (const id of this.chosenIds()) {
        if (!this.known().has(id) && !this.requested.has(id)) {
          this.requested.add(id);
          this.catalog
            .track(id)
            .pipe(
              catchError(() => of(null)),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe((track) => {
              if (track) {
                this.remember([track]);
              }
            });
        }
      }
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.pages.next({ ...this.query, cursor });
    }
  }

  protected isChosen(id: number): boolean {
    return this.chosenIds().includes(id);
  }

  protected setChosen(id: number, chosen: boolean): void {
    const current = this.chosenIds().filter((item) => item !== id);
    const next = chosen ? (this.multiple() ? [...current, id] : [id]) : current;
    this.update(next);
  }

  protected move(id: number, offset: -1 | 1): void {
    const ids = [...this.chosenIds()];
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) {
      return;
    }
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.update(ids);
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

  private describe(error: unknown): string {
    return error instanceof ApiProblem
      ? problemMessage(error, this.i18n)
      : this.i18n.translate('alerts.panelError');
  }
}

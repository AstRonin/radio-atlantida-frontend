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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
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
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { CatalogService, catalogError } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage, controlVersion } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';

/** At most this many artists are offered; more text narrows the search. */
export const ARTIST_SELECT_LIMIT = 50;
export const ARTIST_SELECT_DEBOUNCE_MS = 300;

type Artist = ApiSchema<'Artist'>;

interface Results {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly Artist[];
  total: number;
  error?: string;
}

/** The chosen artist as the input shows it: its name, or a note that the ID is unknown. */
interface Chosen {
  id: number;
  label: string;
}

/**
 * Searchable select of one artist, for example the artist of an import. The backend searches the
 * typed text and returns at most `ARTIST_SELECT_LIMIT` artists, read when the field is first
 * focused and again after a pause in typing. The value is the artist ID; the chosen artist's
 * name is kept here, so it is shown even when the artist is not among the results. Typing text
 * that differs from that name clears the value.
 */
@Component({
  selector: 'app-artist-select',
  imports: [
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          type="search"
          [value]="text()"
          [matAutocomplete]="auto"
          [disabled]="control().disabled"
          (focus)="onFocus()"
          (input)="onInput($event)"
          (blur)="control().markAsTouched()"
        />
        <mat-autocomplete
          #auto="matAutocomplete"
          [displayWith]="displayName"
          (optionSelected)="select($event)"
        >
          @for (artist of results().items; track artist.id) {
            <mat-option [value]="artist.id">{{ artist.name }}</mat-option>
          } @empty {
            @if (results().status === 'ready') {
              <mat-option disabled>{{ 'pickers.noMatches' | translate }}</mat-option>
            }
          }
          @if (more(); as count) {
            <mat-option disabled class="more">{{
              'artists.pickerMore' | translate: { count }
            }}</mat-option>
          }
        </mat-autocomplete>
        @if (loadError(); as message) {
          <mat-hint class="load-error" role="alert">{{ message }}</mat-hint>
        }
        @if (error(); as message) {
          <mat-error>{{ message }}</mat-error>
        }
      </mat-form-field>
      @if (hintPage(); as page) {
        <app-field-hint [page]="page" [field]="hintField() ?? ''" />
      }
    </div>
  `,
  styles: `
    .field {
      width: 100%;
    }

    .load-error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ArtistSelectComponent {
  readonly control = input.required<FormControl<number | null>>();
  readonly label = input('pickers.artist');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  protected readonly error = controlErrorMessage(this.control);
  protected readonly text = signal('');
  private readonly chosen = signal<Chosen | null>(null);
  private readonly lookupError = signal<string | null>(null);
  private readonly version = controlVersion(this.control);

  /** Typed text waits for a pause; the first focus reads at once. */
  private readonly typed = new Subject<string>();
  private readonly focused = new Subject<string>();
  private readonly lookups = new Subject<number>();
  /** The ID whose name is being read, so other control events do not read it again. */
  private lookingUp: number | null = null;

  protected readonly results = signal<Results>({ status: 'idle', items: [], total: 0 });
  protected readonly more = computed(() => {
    const { items, total } = this.results();
    return Math.max(0, total - items.length);
  });
  protected readonly loadError = computed(() => this.results().error ?? this.lookupError());

  // The autocomplete writes the chosen option into the input through this, before `select`.
  protected readonly displayName = (id: number | null): string => {
    const chosen = this.chosen();
    return (
      this.results().items.find((artist) => artist.id === id)?.name ??
      (chosen && chosen.id === id ? chosen.label : '')
    );
  };

  constructor() {
    merge(this.focused, this.typed.pipe(debounceTime(ARTIST_SELECT_DEBOUNCE_MS)))
      .pipe(
        map((text) => text.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          this.catalog
            .artists({ q: q || undefined, sort: 'name', limit: ARTIST_SELECT_LIMIT })
            .pipe(
              map((list): Results => ({ status: 'ready', items: list.items, total: list.total })),
              catchError((error: unknown) =>
                of<Results>({
                  status: 'error',
                  items: [],
                  total: 0,
                  error: catalogError(error, this.i18n),
                }),
              ),
              startWith<Results>({ ...this.results(), status: 'loading', error: undefined }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => this.results.set(results));

    // An ID set by the form, not chosen here: its name is read by ID, as it may be on no page.
    this.lookups
      .pipe(
        switchMap((id) =>
          this.catalog.artist(id).pipe(
            map((artist) => ({ id, label: artist.name, error: null })),
            catchError((error: unknown) =>
              of({
                id,
                label: this.i18n.translate('artists.unknown', { id }),
                // A 404 is said by the label; any other failure also gets the message.
                error:
                  error instanceof ApiProblem && error.status === 404
                    ? null
                    : catalogError(error, this.i18n),
              }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ id, label, error }) => {
        this.lookingUp = null;
        if (this.control().value !== id) {
          return;
        }
        this.lookupError.set(error);
        this.chosen.set({ id, label });
        this.text.set(label);
      });

    // Follows a value set by the form (its start value, a reset, a patch).
    effect(() => {
      this.version();
      const id = this.control().value;
      untracked(() => {
        if (id === null) {
          this.lookingUp = null;
          this.chosen.set(null);
          this.lookupError.set(null);
          if (this.control().pristine) {
            this.text.set('');
          }
          return;
        }
        const chosen = this.chosen();
        if (chosen?.id === id) {
          this.text.set(chosen.label);
          return;
        }
        // The value is kept while its name loads; it is never cleared because it is not found.
        if (this.lookingUp !== id) {
          this.chosen.set(null);
          this.lookingUp = id;
          this.lookups.next(id);
        }
      });
    });
  }

  protected onFocus(): void {
    const chosen = this.chosen();
    // With an artist chosen, its name in the field is not a search: the first page is offered.
    this.focused.next(chosen && chosen.label === this.text() ? '' : this.text());
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.text.set(text);
    this.typed.next(text);
    const control = this.control();
    // Compared with the kept name, not with the results: the chosen artist may be on no page.
    if (control.value !== null && this.chosen()?.label !== text) {
      this.chosen.set(null);
      control.setValue(null);
      control.markAsDirty();
    }
  }

  protected select(event: MatAutocompleteSelectedEvent): void {
    const id = event.option.value as number;
    const name = this.results().items.find((artist) => artist.id === id)?.name ?? '';
    // Set first, so the value change below finds the name and reads nothing.
    this.chosen.set({ id, label: name });
    this.lookupError.set(null);
    const control = this.control();
    control.setValue(id);
    control.markAsDirty();
    control.markAsTouched();
    this.text.set(name);
  }
}

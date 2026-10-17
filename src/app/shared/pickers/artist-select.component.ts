import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage, controlVersion } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';

const SHOWN = 50;

/**
 * Searchable select of one artist, for example the artist of an import. The artist list is
 * read once and filtered as the operator types. The value is the artist ID; typing a name that is
 * not chosen from the list clears it.
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
          (input)="onInput($event)"
          (blur)="control().markAsTouched()"
        />
        <mat-autocomplete
          #auto="matAutocomplete"
          [displayWith]="displayName"
          (optionSelected)="select($event)"
        >
          @for (artist of matches(); track artist.id) {
            <mat-option [value]="artist.id">{{ artist.name }}</mat-option>
          } @empty {
            @if (artists().status === 'ready') {
              <mat-option disabled>{{ 'pickers.noMatches' | translate }}</mat-option>
            }
          }
        </mat-autocomplete>
        @if (artists().error; as message) {
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

  protected readonly artists = catalogList(inject(CatalogService).artists());
  protected readonly error = controlErrorMessage(this.control);
  protected readonly text = signal('');
  private readonly version = controlVersion(this.control);

  // The autocomplete writes the chosen option into the input through this, so it shows the name.
  protected readonly displayName = (id: number | null): string =>
    this.artists().items.find((artist) => artist.id === id)?.name ?? '';

  protected readonly matches = computed(() => {
    const search = this.text().trim().toLocaleLowerCase();
    const artists = this.artists().items;
    const found = search
      ? artists.filter((artist) => artist.name.toLocaleLowerCase().includes(search))
      : artists;
    return found.slice(0, SHOWN);
  });

  constructor() {
    // Shows the name of a value set by the form (its start value, a reset), once the list is here.
    effect(() => {
      this.version();
      const id = this.control().value;
      const artist = this.artists().items.find((item) => item.id === id);
      if (artist) {
        this.text.set(artist.name);
      } else if (id === null && this.control().pristine) {
        this.text.set('');
      }
    });
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.text.set(text);
    const control = this.control();
    const chosen = this.artists().items.find((artist) => artist.id === control.value);
    if (control.value !== null && chosen?.name !== text) {
      control.setValue(null);
      control.markAsDirty();
    }
  }

  protected select(event: MatAutocompleteSelectedEvent): void {
    const id = event.option.value as number;
    const control = this.control();
    control.setValue(id);
    control.markAsDirty();
    control.markAsTouched();
    this.text.set(this.artists().items.find((artist) => artist.id === id)?.name ?? '');
  }
}

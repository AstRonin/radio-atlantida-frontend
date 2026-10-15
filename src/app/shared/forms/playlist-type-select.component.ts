import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/**
 * A select for the playlist type (design §6.2), read from `GET /api/playlist-types` each time it
 * is shown, so a type added a moment ago is offered. The value is the type ID.
 */
@Component({
  selector: 'app-playlist-type-select',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <mat-select [formControl]="control()">
          @for (type of types().items; track type.id) {
            <mat-option [value]="type.id">{{ type.name }}</mat-option>
          }
        </mat-select>
        @if (types().error; as message) {
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
      max-width: 20rem;
    }

    .load-error {
      color: var(--mat-sys-error);
    }
  `,
})
export class PlaylistTypeSelectComponent {
  readonly control = input.required<FormControl<number | null>>();
  readonly label = input('forms.playlistType');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly types = catalogList(inject(CatalogService).playlistTypes());
  protected readonly error = controlErrorMessage(this.control);
}

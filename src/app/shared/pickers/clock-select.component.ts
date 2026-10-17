import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';

/** Select of one clock, for example the clock of a grid assignment. The value is the clock ID. */
@Component({
  selector: 'app-clock-select',
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
          @for (clock of clocks().items; track clock.id) {
            <mat-option [value]="clock.id">
              {{ clock.name }}
            </mat-option>
          }
        </mat-select>
        @if (clocks().error; as message) {
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
export class ClockSelectComponent {
  readonly control = input.required<FormControl<number | null>>();
  readonly label = input('pickers.clock');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly clocks = catalogList(inject(CatalogService).clocks());
  protected readonly error = controlErrorMessage(this.control);
}

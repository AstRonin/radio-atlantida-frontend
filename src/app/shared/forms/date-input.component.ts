import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { MatDatepickerIntl, MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';
import {
  STATION_DATE_FORMATS,
  StationDateAdapter,
  TranslatedDatepickerIntl,
} from './station-date-adapter';

/**
 * A calendar date, `YYYY-MM-DD` in station local time, typed or chosen in a `MatDatepicker`
 * (design §6.2: grid slot `valid_from` and `valid_to`, and the date ranges of the views). `min` and
 * `max` take the same form; a date outside them cannot be chosen and fails validation.
 */
@Component({
  selector: 'app-date-input',
  imports: [
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  providers: [
    { provide: DateAdapter, useClass: StationDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: STATION_DATE_FORMATS },
    { provide: MatDatepickerIntl, useClass: TranslatedDatepickerIntl },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          [matDatepicker]="picker"
          [formControl]="control()"
          [min]="min()"
          [max]="max()"
          [placeholder]="'forms.datepicker.format' | translate"
        />
        <mat-datepicker-toggle matIconSuffix [for]="picker" />
        <mat-datepicker #picker />
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
      max-width: 14rem;
    }
  `,
})
export class DateInputComponent {
  readonly control = input.required<FormControl<string | null>>();
  readonly label = input.required<string>();
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

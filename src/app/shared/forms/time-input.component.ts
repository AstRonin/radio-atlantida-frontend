import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTimepickerModule } from '@angular/material/timepicker';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';
import { TIME_OF_DAY_FORMATS, TimeOfDayAdapter } from './time-of-day-adapter';

/**
 * A time of day, `HH:MM` in station local time (design §6.2, §10.2), typed or chosen in a
 * `MatTimepicker` list in steps of 15 minutes. The value is always `HH:MM` or null; text that is
 * not a time fails validation. Pair it with `timeOfDayValidator`.
 */
@Component({
  selector: 'app-time-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatTimepickerModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  providers: [
    { provide: DateAdapter, useClass: TimeOfDayAdapter },
    { provide: MAT_DATE_FORMATS, useValue: TIME_OF_DAY_FORMATS },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          [matTimepicker]="picker"
          [formControl]="control()"
          [placeholder]="'forms.timepicker.format' | translate"
        />
        <mat-timepicker-toggle
          matIconSuffix
          [for]="picker"
          [aria-label]="'forms.timepicker.open' | translate"
        />
        <mat-timepicker #picker interval="15m" />
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
      max-width: 12rem;
    }
  `,
})
export class TimeInputComponent {
  readonly control = input.required<FormControl<string | null>>();
  readonly label = input.required<string>();
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

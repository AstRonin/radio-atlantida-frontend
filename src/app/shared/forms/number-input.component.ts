import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/**
 * A number field (design §6.2): `type="number"` with `min`, `max`, and `step`, so the browser
 * refuses text. Put the matching `rangeValidator` on the control; these attributes only guide input.
 */
@Component({
  selector: 'app-number-input',
  imports: [
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
          type="number"
          inputmode="decimal"
          [formControl]="control()"
          [attr.min]="min()"
          [attr.max]="max()"
          [attr.step]="step()"
        />
        @if (suffix(); as unit) {
          <span matTextSuffix>{{ unit | translate }}</span>
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
  `,
})
export class NumberInputComponent {
  readonly control = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly step = input<number | 'any'>(1);
  /** Translation key of the unit shown after the value, for example `forms.units.ms`. */
  readonly suffix = input<string | null>(null);
  /** The page help that holds the field hint; the hint is keyed by `hintField`. */
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

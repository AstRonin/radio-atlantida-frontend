import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/**
 * A text field, or a text area with `multiline`. `maxLength` mirrors the DTO's `maxLength`, so the
 * browser stops at the limit; put the matching `Validators.maxLength` on the control as well.
 */
@Component({
  selector: 'app-text-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ label() | translate }}</mat-label>
      @if (multiline()) {
        <textarea
          matInput
          rows="3"
          [formControl]="control()"
          [attr.maxlength]="maxLength()"
        ></textarea>
      } @else {
        <input
          matInput
          type="text"
          [formControl]="control()"
          [attr.maxlength]="maxLength()"
          [attr.spellcheck]="spellcheck()"
          [attr.autocomplete]="'off'"
        />
      }
      @if (hint(); as text) {
        <mat-hint>{{ text | translate }}</mat-hint>
      }
      @if (hintPage(); as page) {
        <app-field-hint matSuffix [page]="page" [field]="hintField() ?? ''" />
      }
      @if (error(); as message) {
        <mat-error>{{ message }}</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
    }
  `,
})
export class TextInputComponent {
  readonly control = input.required<FormControl<string | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  readonly maxLength = input<number | null>(null);
  readonly multiline = input(false);
  /** Off for codes and paths, where the browser's spelling marks only distract. */
  readonly spellcheck = input(true);
  /** Translation key of a short hint under the field. */
  readonly hint = input<string | null>(null);
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

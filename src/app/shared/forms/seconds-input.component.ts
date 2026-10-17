import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  forwardRef,
  inject,
  input,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';
import type { RangeError } from './validators';

/**
 * Binds a `type="number"` input in whole seconds to a value in milliseconds, the unit of the API.
 * The range is checked here, in seconds, so the message names the numbers the operator typed.
 */
@Directive({
  selector: 'input[appSeconds]',
  host: { '(input)': 'onInput()', '(blur)': 'onTouched()' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SecondsDirective), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => SecondsDirective), multi: true },
  ],
})
export class SecondsDirective implements ControlValueAccessor, Validator {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);

  // Not `min` and `max`: on a number input those names turn on Angular's own validators, which
  // would compare the milliseconds of the control with limits in seconds.
  readonly minSeconds = input(0);
  readonly maxSeconds = input(Number.MAX_SAFE_INTEGER);

  private onChange: (value: number | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(value: number | null): void {
    this.element.nativeElement.value = value === null ? '' : String(value / 1000);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.element.nativeElement.disabled = disabled;
  }

  validate(): ValidationErrors | null {
    const text = this.element.nativeElement.value;
    if (text === '') {
      return null;
    }
    const seconds = Number(text);
    const min = this.minSeconds();
    const max = this.maxSeconds();
    const error: RangeError = { min, max, step: 1 };
    if (!Number.isFinite(seconds) || seconds < min || seconds > max) {
      return { range: error };
    }
    return Number.isInteger(seconds) ? null : { step: error };
  }

  protected onInput(): void {
    const text = this.element.nativeElement.value;
    const seconds = Number(text);
    this.onChange(text === '' || !Number.isFinite(seconds) ? null : Math.round(seconds * 1000));
  }
}

/**
 * A length in whole seconds whose value is milliseconds (frontend F21 §5.3: an insert's start
 * tolerance). The browser refuses text; the range is given in seconds.
 */
@Component({
  selector: 'app-seconds-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
    SecondsDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          type="number"
          inputmode="numeric"
          step="1"
          appSeconds
          [minSeconds]="min()"
          [maxSeconds]="max()"
          [attr.min]="min()"
          [attr.max]="max()"
          [formControl]="control()"
        />
        <span matTextSuffix>{{ 'forms.units.s' | translate }}</span>
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
export class SecondsInputComponent {
  readonly control = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  /** Limits in seconds. */
  readonly min = input(0);
  readonly max = input(Number.MAX_SAFE_INTEGER);
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

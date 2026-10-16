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
import { formatCueTime, parseCueTime } from '../../core/time/duration';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/** Validation key of text that is not a time. */
export const CUE_TIME_ERROR = 'cueTime';

/**
 * Binds a text input to a value in milliseconds: shows `m:ss.SSS`, reads `m:ss.SSS`, `m:ss`, or
 * seconds. Text that is not a time leaves the value null and fails with `cueTime`. The text is
 * written again in the standard form when the field loses focus.
 */
@Directive({
  selector: 'input[appCueTime]',
  host: { '(input)': 'onInput()', '(blur)': 'onBlur()' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CueTimeDirective), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => CueTimeDirective), multi: true },
  ],
})
export class CueTimeDirective implements ControlValueAccessor, Validator {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private unreadable = false;
  private value: number | null = null;
  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: number | null): void {
    this.value = value;
    this.unreadable = false;
    this.element.nativeElement.value = value === null ? '' : formatCueTime(value);
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
    return this.unreadable ? { [CUE_TIME_ERROR]: true } : null;
  }

  protected onInput(): void {
    const text = this.element.nativeElement.value;
    const parsed = parseCueTime(text);
    this.unreadable = parsed === null && text.trim() !== '';
    this.value = parsed;
    this.onChange(parsed);
  }

  protected onBlur(): void {
    if (!this.unreadable && this.value !== null) {
      this.element.nativeElement.value = formatCueTime(this.value);
    }
    this.onTouched();
  }
}

/**
 * A point or length in a track to the millisecond, `m:ss.SSS` (frontend F20 §5.2). The value is
 * milliseconds; put the range validators on the control.
 */
@Component({
  selector: 'app-duration-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
    CueTimeDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          appCueTime
          inputmode="decimal"
          autocomplete="off"
          [spellcheck]="false"
          [formControl]="control()"
          [placeholder]="'forms.cueTime.format' | translate"
        />
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
export class DurationInputComponent {
  readonly control = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

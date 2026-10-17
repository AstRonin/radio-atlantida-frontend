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
import { HOUR_OFFSET_MAX_MS, formatHourOffset, parseHourOffset } from '../../core/time/duration';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/** Validation key of text that is not a point in the hour. */
export const HOUR_OFFSET_ERROR = 'hourOffset';

const SECOND = 1000;
const MINUTE = 60_000;

/**
 * Binds a text input to a point in the hour in milliseconds: shows and reads `mm:ss`. Text that is
 * not a time in the hour leaves the value null and fails with `hourOffset`. The arrow keys step one
 * second, with Shift or Page Up and Page Down one minute.
 */
@Directive({
  selector: 'input[appHourOffset]',
  host: { '(input)': 'onInput()', '(blur)': 'onBlur()', '(keydown)': 'onKeydown($event)' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => HourOffsetDirective), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => HourOffsetDirective), multi: true },
  ],
})
export class HourOffsetDirective implements ControlValueAccessor, Validator {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private unreadable = false;
  private value: number | null = null;
  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: number | null): void {
    this.value = value;
    this.unreadable = false;
    this.element.nativeElement.value = value === null ? '' : formatHourOffset(value);
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
    return this.unreadable ? { [HOUR_OFFSET_ERROR]: true } : null;
  }

  protected onInput(): void {
    const text = this.element.nativeElement.value;
    const parsed = parseHourOffset(text);
    this.unreadable = parsed === null && text.trim() !== '';
    this.value = parsed;
    this.onChange(parsed);
  }

  protected onBlur(): void {
    if (!this.unreadable && this.value !== null) {
      this.element.nativeElement.value = formatHourOffset(this.value);
    }
    this.onTouched();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const step = keyStep(event);
    if (step === 0 || this.unreadable) {
      return;
    }
    event.preventDefault();
    const next = Math.min(HOUR_OFFSET_MAX_MS, Math.max(0, (this.value ?? 0) + step));
    this.writeValue(next);
    this.onChange(next);
  }
}

function keyStep(event: KeyboardEvent): number {
  switch (event.key) {
    case 'ArrowUp':
      return event.shiftKey ? MINUTE : SECOND;
    case 'ArrowDown':
      return event.shiftKey ? -MINUTE : -SECOND;
    case 'PageUp':
      return MINUTE;
    case 'PageDown':
      return -MINUTE;
    default:
      return 0;
  }
}

/**
 * A point in the hour with seconds, `mm:ss` from 0:00 to 59:59 (frontend F21 §5.1): the time of an
 * insert. The value is milliseconds in whole seconds, as `offset_ms` is sent.
 */
@Component({
  selector: 'app-offset-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
    HourOffsetDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ label() | translate }}</mat-label>
        <input
          matInput
          appHourOffset
          inputmode="numeric"
          autocomplete="off"
          [spellcheck]="false"
          [formControl]="control()"
          [placeholder]="'forms.hourOffset.format' | translate"
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
export class OffsetInputComponent {
  readonly control = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);
}

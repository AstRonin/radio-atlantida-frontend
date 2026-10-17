import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Subscription, merge } from 'rxjs';
import type { HelpPageId } from '../../core/help/help-content';
import type { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

/** Hours and minutes of a number of minutes; null parts for no value. */
export function splitMinutes(minutes: number | null): {
  hours: number | null;
  minutes: number | null;
} {
  if (minutes === null || !Number.isFinite(minutes)) {
    return { hours: null, minutes: null };
  }
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** The number of minutes of hours and minutes; null when both are empty. */
export function joinMinutes(hours: number | null, minutes: number | null): number | null {
  if (hours === null && minutes === null) {
    return null;
  }
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** An interval as the operator thinks of it: `72 h`, `1 h 30 min`, `20 min`. */
export function formatInterval(i18n: I18nService, minutes: number): string {
  const parts = splitMinutes(minutes);
  const hours = parts.hours ?? 0;
  const rest = parts.minutes ?? 0;
  if (hours === 0) {
    return i18n.translate('forms.interval.short.minutes', { minutes: rest });
  }
  return rest === 0
    ? i18n.translate('forms.interval.short.hours', { hours })
    : i18n.translate('forms.interval.short.hoursMinutes', { hours, minutes: rest });
}

/**
 * A play rule interval as hours and minutes (frontend F21 §5.6), so 72 hours is typed as 72 and 0.
 * The value is minutes, as the API takes it; put the range validators on the control. Both fields
 * empty means no interval.
 */
@Component({
  selector: 'app-interval-input',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="interval">
      <legend>
        {{ label() | translate }}
        @if (hintPage(); as page) {
          <app-field-hint [page]="page" [field]="hintField() ?? ''" />
        }
      </legend>
      <mat-form-field>
        <mat-label>{{ 'forms.interval.hours' | translate }}</mat-label>
        <input matInput type="number" inputmode="numeric" min="0" step="1" [formControl]="hours" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'forms.interval.minutes' | translate }}</mat-label>
        <input
          matInput
          type="number"
          inputmode="numeric"
          min="0"
          max="59"
          step="1"
          [formControl]="minutes"
        />
      </mat-form-field>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </fieldset>
  `,
  styles: `
    .interval {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.75rem;
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }

    legend {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
      padding: 0 0.25rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    mat-form-field {
      flex: 1 1 7rem;
    }

    .error {
      flex-basis: 100%;
      margin: 0 0 0.5rem;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class IntervalInputComponent {
  readonly control = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input.required<string>();
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly hours = new FormControl<number | null>(null);
  protected readonly minutes = new FormControl<number | null>(null);
  protected readonly error = controlErrorMessage(this.control);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let outer: Subscription | undefined;
    destroyRef.onDestroy(() => outer?.unsubscribe());

    // The outer control is the value; the two fields only show it. A value set from outside
    // (a load, a reset) is written into the fields without echoing back.
    effect(() => {
      const control = this.control();
      outer?.unsubscribe();
      this.show(control);
      outer = control.events.subscribe(() => this.show(control));
    });

    merge(this.hours.valueChanges, this.minutes.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const control = this.control();
        const value = joinMinutes(numberOrNull(this.hours.value), numberOrNull(this.minutes.value));
        if (value !== control.value) {
          control.setValue(value);
          control.markAsDirty();
        }
        control.markAsTouched();
      });
  }

  private show(control: FormControl<number | null>): void {
    const shown = joinMinutes(numberOrNull(this.hours.value), numberOrNull(this.minutes.value));
    if (shown !== control.value) {
      const parts = splitMinutes(control.value);
      this.hours.setValue(parts.hours, { emitEvent: false });
      this.minutes.setValue(parts.minutes, { emitEvent: false });
    }
    for (const field of [this.hours, this.minutes]) {
      if (control.disabled && field.enabled) {
        field.disable({ emitEvent: false });
      } else if (control.enabled && field.disabled) {
        field.enable({ emitEvent: false });
      }
    }
  }
}

// An emptied number field gives null; a typed one a number.
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

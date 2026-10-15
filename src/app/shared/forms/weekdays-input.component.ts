import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import type { HelpPageId } from '../../core/help/help-content';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage, controlVersion } from './field-errors';

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

// 2024-01-01 was a Monday, so day N of the week is January N.
const MONDAY_UTC = Date.UTC(2024, 0, 1);

/**
 * Weekdays as checkboxes, never typed (design §6.2). The value is a sorted list of 1 = Monday to
 * 7 = Sunday, as the API sends it. Day names come from the active language's locale.
 */
@Component({
  selector: 'app-weekdays-input',
  imports: [MatCheckboxModule, TranslatePipe, FieldHintComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="days" [disabled]="control().disabled">
      <legend>
        {{ label() | translate }}
        @if (hintPage(); as page) {
          <app-field-hint [page]="page" [field]="hintField() ?? ''" />
        }
      </legend>
      @for (day of days(); track day.value) {
        <mat-checkbox
          [checked]="selected().has(day.value)"
          [disabled]="control().disabled"
          (change)="toggle(day.value, $event.checked)"
        >
          {{ day.name }}
        </mat-checkbox>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </fieldset>
  `,
  styles: `
    .days {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.5rem;
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem;
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

    .error {
      flex-basis: 100%;
      margin: 0.25rem 0 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class WeekdaysInputComponent {
  private readonly i18n = inject(I18nService);

  readonly control = input.required<FormControl<number[] | null>>();
  readonly label = input('forms.weekdays.label');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly error = controlErrorMessage(this.control);

  protected readonly days = computed(() => {
    const format = new Intl.DateTimeFormat(this.i18n.locale(), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return WEEKDAYS.map((value) => ({
      value,
      name: format.format(MONDAY_UTC + (value - 1) * 86_400_000),
    }));
  });

  // The value can change from outside, as the grid's cell buttons do; reading it through the
  // control's events keeps the checkboxes in step in an OnPush view.
  private readonly version = controlVersion(this.control);
  protected readonly selected = computed(() => {
    this.version();
    return new Set(this.control().value ?? []);
  });

  protected toggle(day: number, checked: boolean): void {
    const control = this.control();
    const days = new Set(control.value ?? []);
    if (checked) {
      days.add(day);
    } else {
      days.delete(day);
    }
    control.setValue([...days].sort((a, b) => a - b));
    control.markAsDirty();
    control.markAsTouched();
  }
}

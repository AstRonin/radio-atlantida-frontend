import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormControl } from '@angular/forms';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { hourLabel } from '../../core/time/local-date';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage, controlVersion } from './field-errors';

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Hours of the day as toggle buttons, never typed (design §6.2). The value is a sorted list of
 * 0 to 23, station local, as the grid API takes it.
 */
@Component({
  selector: 'app-hours-input',
  imports: [TranslatePipe, FieldHintComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="hours" [disabled]="control().disabled">
      <legend>
        {{ label() | translate }}
        @if (hintPage(); as page) {
          <app-field-hint [page]="page" [field]="hintField() ?? ''" />
        }
      </legend>
      @for (hour of hours; track hour) {
        <button
          type="button"
          class="hour"
          [class.selected]="selected().has(hour)"
          [attr.aria-pressed]="selected().has(hour)"
          (click)="toggle(hour)"
        >
          {{ hourText(hour) }}
        </button>
      }
      <span class="shortcuts">
        <button type="button" class="link" (click)="setAll(true)">
          {{ 'forms.hours.all' | translate }}
        </button>
        <button type="button" class="link" (click)="setAll(false)">
          {{ 'forms.hours.none' | translate }}
        </button>
      </span>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </fieldset>
  `,
  styles: `
    .hours {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
      gap: 0.25rem;
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

    .hour {
      padding: 0.25rem 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-medium);
      cursor: pointer;
    }

    .hour.selected {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    .shortcuts {
      grid-column: 1 / -1;
      display: flex;
      gap: 1rem;
    }

    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-medium);
      cursor: pointer;
    }

    .error {
      grid-column: 1 / -1;
      margin: 0.25rem 0 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class HoursInputComponent {
  readonly control = input.required<FormControl<number[] | null>>();
  readonly label = input('forms.hours.label');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly hours = HOURS;
  protected readonly hourText = hourLabel;
  protected readonly error = controlErrorMessage(this.control);
  private readonly version = controlVersion(this.control);
  protected readonly selected = computed(() => {
    this.version();
    return new Set(this.control().value ?? []);
  });

  protected toggle(hour: number): void {
    const hours = new Set(this.selected());
    if (hours.has(hour)) {
      hours.delete(hour);
    } else {
      hours.add(hour);
    }
    this.write([...hours]);
  }

  protected setAll(all: boolean): void {
    this.write(all ? [...HOURS] : []);
  }

  private write(hours: number[]): void {
    const control = this.control();
    control.setValue(hours.sort((a, b) => a - b));
    control.markAsDirty();
    control.markAsTouched();
  }
}

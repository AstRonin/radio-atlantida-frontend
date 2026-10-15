import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '../i18n/translate.pipe';
import { DEFAULT_TIME_ZONE } from './station-time.service';

/**
 * IANA timezone names known to this browser, sorted. `UTC` is added because some engines list
 * only region names. The station timezone is chosen from this list, never typed (design §6.2).
 */
export function timeZoneNames(): readonly string[] {
  const names = new Set(Intl.supportedValuesOf('timeZone'));
  names.add('UTC');
  names.add(DEFAULT_TIME_ZONE);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Select for an IANA timezone on a reactive form control. A value the browser does not list (for
 * example one saved by a newer browser) stays selectable, so opening the form never changes it.
 */
@Component({
  selector: 'app-time-zone-select',
  imports: [MatFormFieldModule, MatSelectModule, ReactiveFormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ label() | translate }}</mat-label>
      <mat-select [formControl]="control()">
        @for (name of options(); track name) {
          <mat-option [value]="name">{{ name }}</mat-option>
        }
      </mat-select>
      @if (control().hasError('required')) {
        <mat-error>{{ 'time.zoneRequired' | translate }}</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
      max-width: 24rem;
    }
  `,
})
export class TimeZoneSelectComponent {
  readonly control = input.required<FormControl<string | null>>();
  /** Translation key of the field label. */
  readonly label = input('time.zoneLabel');

  private readonly names = timeZoneNames();

  // A method, not computed: the control's value is not a signal and may be set after the first render.
  protected options(): readonly string[] {
    const value = this.control().value;
    return value && !this.names.includes(value) ? [value, ...this.names] : this.names;
  }
}

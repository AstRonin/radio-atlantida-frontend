import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ApiSchema } from '../../core/api/api-types';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage } from './field-errors';

export type ElementFillerMode = ApiSchema<'ClockElementBody'>['filler_mode'];
export type SegmentFillerMode = ApiSchema<'SegmentFillerChoice'>['filler_mode'];
export type DefaultFillerMode = NonNullable<ApiSchema<'ClockBody'>['default_filler_mode']>;

/**
 * Which modes are offered, matching the backend enums:
 * - `element`: a clock element's `filler_mode`;
 * - `segment`: a choice in the blocking filler dialog (`none` is not a choice);
 * - `default`: a clock's default mode, where empty means the global fallback; `ask` and `pool`
 *   cannot be a fallback (design §4, §6.2);
 * - `fallback`: the global fallback itself (setting `filler.fallback`), which has no further
 *   fallback to offer.
 */
export type FillerModeSet = 'element' | 'segment' | 'default' | 'fallback';

const MODES: Readonly<Record<FillerModeSet, readonly ElementFillerMode[]>> = {
  element: ['none', 'ask', 'random', 'playlist', 'artist', 'pool'],
  segment: ['ask', 'random', 'playlist', 'artist', 'pool'] satisfies SegmentFillerMode[],
  default: ['random', 'playlist', 'artist'] satisfies DefaultFillerMode[],
  fallback: ['random', 'playlist', 'artist'] satisfies DefaultFillerMode[],
};

/** A select for a filler mode (design §6.2). Labels are `filler.modes.<mode>`. */
@Component({
  selector: 'app-filler-mode-select',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ label() | translate }}</mat-label>
      <mat-select [formControl]="control()">
        @if (modes() === 'default') {
          <mat-option [value]="null">{{ 'filler.modes.global' | translate }}</mat-option>
        }
        @for (mode of options(); track mode) {
          <mat-option [value]="mode">{{ 'filler.modes.' + mode | translate }}</mat-option>
        }
      </mat-select>
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
      max-width: 20rem;
    }
  `,
})
export class FillerModeSelectComponent {
  readonly control = input.required<FormControl<ElementFillerMode | null>>();
  readonly modes = input<FillerModeSet>('element');
  readonly label = input('filler.modeLabel');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly options = computed(() => MODES[this.modes()]);
  protected readonly error = controlErrorMessage(this.control);
}

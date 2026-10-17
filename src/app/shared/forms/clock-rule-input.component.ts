import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ApiSchema } from '../../core/api/api-types';
import type { HelpPageId } from '../../core/help/help-content';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../ui/field-hint.component';
import { controlErrorMessage, controlVersion } from './field-errors';
import { NumberInputComponent } from './number-input.component';
import { rangeValidator } from './validators';

export type ClockRule = ApiSchema<'Playlist'>['clock_rule'];

/** The options of the placement rule, in the order of the design (§7.2). */
export const CLOCK_RULES: readonly ClockRule[] = [
  'fill',
  'spread',
  'start',
  'end',
  'start_end',
  'middle',
];

/** Limits of `clock_count`: only for `spread`. */
export const CLOCK_COUNT = { min: 1, max: 12 } as const;

/** A short label of a rule: "Fill", "2 × spread", "Start". */
export function clockRuleLabel(i18n: I18nService, rule: ClockRule, count?: number | null): string {
  return rule === 'spread' && count !== null && count !== undefined
    ? i18n.translate('forms.clockRule.spreadCount', { count })
    : i18n.translate(`forms.clockRule.rules.${rule}`);
}

/**
 * Enables the count only for `spread`, where it is required (1 to 12), and disables it otherwise,
 * so it is neither validated nor sent (`clock_count_required`, `clock_count_not_allowed`). A rule
 * control without a value (an override that is off) disables the count too.
 */
export function linkClockCount(
  rule: FormControl<ClockRule | null>,
  count: FormControl<number | null>,
  destroyRef: DestroyRef,
): void {
  count.setValidators([Validators.required, rangeValidator({ ...CLOCK_COUNT, step: 1 })]);
  const sync = (value: ClockRule | null) => {
    if (value === 'spread') {
      count.enable({ emitEvent: false });
    } else {
      count.disable({ emitEvent: false });
    }
    count.updateValueAndValidity();
  };
  sync(rule.value);
  rule.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(sync);
}

/**
 * The placement rule of a playlist in clocks (frontend F21 §5.1): a select of the backend's rules
 * and, only for `spread`, the number of tracks. Used on the playlist page and, with `inherited`, as
 * a clock's override of the playlist's own rule. Link the controls with `linkClockCount()`.
 */
@Component({
  selector: 'app-clock-rule-input',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
    NumberInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rule">
      <div class="field field-row">
        <mat-form-field>
          <mat-label>{{ label() | translate }}</mat-label>
          <mat-select [formControl]="rule()">
            @for (option of rules; track option) {
              <mat-option [value]="option">
                {{ 'forms.clockRule.rules.' + option | translate }}
              </mat-option>
            }
          </mat-select>
          @if (ruleHint(); as hint) {
            <mat-hint>{{ hint }}</mat-hint>
          }
          @if (error(); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>
        @if (hintPage(); as page) {
          <app-field-hint [page]="page" field="clock_rule" />
        }
      </div>
      @if (isSpread()) {
        <app-number-input
          label="forms.clockRule.count"
          [control]="count()"
          [min]="countLimits.min"
          [max]="countLimits.max"
          [hintPage]="hintPage()"
          hintField="clock_count"
        />
      }
    </div>
  `,
  styles: `
    .rule {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 0 1rem;
    }

    .field {
      width: 100%;
    }
  `,
})
export class ClockRuleInputComponent {
  private readonly i18n = inject(I18nService);

  readonly rule = input.required<FormControl<ClockRule | null>>();
  readonly count = input.required<FormControl<number | null>>();
  /** Translation key of the label. */
  readonly label = input('forms.clockRule.label');
  /** The playlist's own rule, shown when this input overrides it in a clock. */
  readonly inherited = input<{ rule: ClockRule; count?: number | null } | null>(null);
  readonly hintPage = input<HelpPageId | null>(null);

  protected readonly rules = CLOCK_RULES;
  protected readonly countLimits = CLOCK_COUNT;
  protected readonly error = controlErrorMessage(this.rule);
  private readonly version = controlVersion(this.rule);
  protected readonly isSpread = computed(() => {
    this.version();
    return this.rule().value === 'spread';
  });
  protected readonly ruleHint = computed(() => {
    const inherited = this.inherited();
    if (inherited) {
      return this.i18n.translate('forms.clockRule.inherited', {
        rule: clockRuleLabel(this.i18n, inherited.rule, inherited.count),
      });
    }
    this.version();
    const rule = this.rule().value;
    return rule ? this.i18n.translate(`forms.clockRule.hints.${rule}`) : null;
  });
}

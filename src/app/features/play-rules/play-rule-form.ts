import {
  AbstractControl,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import {
  atLeastOneValidator,
  bothOrNoneValidator,
  rangeValidator,
  timeOfDayValidator,
  weekdaysValidator,
} from '../../shared/forms/validators';

export type PlayRule = ApiSchema<'PlayRule'>;
export type PlayRuleBody = ApiSchema<'PlayRuleBody'>;

/** Limits of `PlayRuleBody`. */
export const PLAY_RULE_LIMITS = {
  nameMax: 200,
  notesMax: 2000,
  minIntervalMax: 10_080,
  perHourMax: 60,
} as const;

/** The limits of a rule; the backend refuses a rule that sets none of them (design §7.3). */
export const CONSTRAINT_FIELDS = [
  'window_from',
  'weekdays',
  'min_interval_minutes',
  'max_per_hour',
] as const;

/**
 * A window from a time to the same time is refused: a window may cross midnight, so it is
 * ambiguous whether it means no time or the whole day. The error is on the group.
 */
export const windowDiffersValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const from: unknown = group.get('window_from')?.value;
  const to: unknown = group.get('window_to')?.value;
  return from && from === to ? { sameWindow: true } : null;
};

export type PlayRuleForm = ReturnType<typeof playRuleForm>;

/** The play rule form; control names are the DTO's JSON names. */
export function playRuleForm() {
  return new FormGroup(
    {
      name: new FormControl<string | null>('', [
        Validators.required,
        Validators.maxLength(PLAY_RULE_LIMITS.nameMax),
      ]),
      window_from: new FormControl<string | null>(null, timeOfDayValidator),
      window_to: new FormControl<string | null>(null, timeOfDayValidator),
      weekdays: new FormControl<number[] | null>(null, weekdaysValidator),
      min_interval_minutes: new FormControl<number | null>(
        null,
        rangeValidator({ min: 1, max: PLAY_RULE_LIMITS.minIntervalMax, step: 1 }),
      ),
      max_per_hour: new FormControl<number | null>(
        null,
        rangeValidator({ min: 1, max: PLAY_RULE_LIMITS.perHourMax, step: 1 }),
      ),
      notes: new FormControl<string | null>('', Validators.maxLength(PLAY_RULE_LIMITS.notesMax)),
      track_ids: new FormControl<number[] | null>([]),
      playlist_ids: new FormControl<number[] | null>([]),
    },
    {
      validators: [
        bothOrNoneValidator(['window_from', 'window_to']),
        windowDiffersValidator,
        atLeastOneValidator(CONSTRAINT_FIELDS),
      ],
    },
  );
}

/** The form value of a stored rule. */
export function playRuleFormValue(rule: PlayRule): PlayRuleForm['value'] {
  return {
    name: rule.name,
    window_from: rule.window_from ?? null,
    window_to: rule.window_to ?? null,
    weekdays: rule.weekdays ?? null,
    min_interval_minutes: rule.min_interval_minutes ?? null,
    max_per_hour: rule.max_per_hour ?? null,
    notes: rule.notes,
    track_ids: rule.track_ids,
    playlist_ids: rule.playlist_ids,
  };
}

/** The request body. No weekdays chosen means every day, which the API expresses as null. */
export function playRuleBody(form: PlayRuleForm): PlayRuleBody {
  const value = form.getRawValue();
  return {
    name: (value.name ?? '').trim(),
    window_from: value.window_from || null,
    window_to: value.window_to || null,
    weekdays: value.weekdays && value.weekdays.length > 0 ? value.weekdays : undefined,
    min_interval_minutes: value.min_interval_minutes ?? null,
    max_per_hour: value.max_per_hour ?? null,
    notes: (value.notes ?? '').trim(),
  };
}

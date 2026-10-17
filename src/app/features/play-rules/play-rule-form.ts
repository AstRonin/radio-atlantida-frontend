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
  /** The DTO's cap; the play log retention usually caps the intervals lower. */
  intervalMax: 525_600,
  perHourMax: 60,
} as const;

/**
 * The longest interval the backend accepts: the play log keeps the history it is checked against
 * for `retention.play_log_days` days (`interval_beyond_retention`, design §4.1).
 */
export function intervalMaxMinutes(playLogDays: unknown): number {
  return typeof playLogDays === 'number' && playLogDays > 0
    ? Math.min(PLAY_RULE_LIMITS.intervalMax, playLogDays * 1440)
    : PLAY_RULE_LIMITS.intervalMax;
}

/** The limits of a rule; the backend refuses a rule that sets none of them (design §7.3). */
export const CONSTRAINT_FIELDS = [
  'window_from',
  'weekdays',
  'min_interval_minutes',
  'artist_min_interval_minutes',
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

/** The play rule form; control names are the DTO's JSON names. Intervals are minutes. */
export function playRuleForm(intervalMax: number = PLAY_RULE_LIMITS.intervalMax) {
  const interval = rangeValidator({ min: 1, max: intervalMax, step: 1 });
  return new FormGroup(
    {
      name: new FormControl<string | null>('', [
        Validators.required,
        Validators.maxLength(PLAY_RULE_LIMITS.nameMax),
      ]),
      window_from: new FormControl<string | null>(null, timeOfDayValidator),
      window_to: new FormControl<string | null>(null, timeOfDayValidator),
      weekdays: new FormControl<number[] | null>(null, weekdaysValidator),
      min_interval_minutes: new FormControl<number | null>(null, interval),
      artist_min_interval_minutes: new FormControl<number | null>(null, interval),
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
    artist_min_interval_minutes: rule.artist_min_interval_minutes ?? null,
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
    artist_min_interval_minutes: value.artist_min_interval_minutes ?? null,
    max_per_hour: value.max_per_hour ?? null,
    notes: (value.notes ?? '').trim(),
  };
}

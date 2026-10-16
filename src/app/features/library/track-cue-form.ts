import { AbstractControl, FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import type { ApiSchema, FieldErrorCode } from '../../core/api/api-types';
import { rangeValidator } from '../../shared/forms/validators';

type Track = ApiSchema<'Track'>;
export type TrackCueBody = ApiSchema<'TrackCueBody'>;

/** `TrackCueBody` limits (backend phase 22 §3.3). */
export const CUE_LIMITS = {
  fadeMaxMs: 5000,
  /** A cut leaves at least this much on air (`air_too_short`). */
  minAirMs: 5000,
  /** "Play last 5 s before stop". */
  previewBeforeOutMs: 5000,
} as const;

/** Quick choices next to the fade fields. */
export const FADE_CHOICES_MS: readonly number[] = [0, 1000, 2000, 3000];

export type CueForm = FormGroup<{
  cue_in_ms: FormControl<number | null>;
  /** Always a point in the file in the form; the end of the file is sent as null. */
  cue_out_ms: FormControl<number | null>;
  fade_in_ms: FormControl<number | null>;
  fade_out_ms: FormControl<number | null>;
  /** "Mark as reviewed": not part of the body, sent with `POST /api/tracks/review` after it. */
  reviewed: FormControl<boolean>;
}>;

/** The group error of a cue that the backend would refuse, with the field it names. */
export interface CueError {
  code: Extract<
    FieldErrorCode,
    'cue_order' | 'cue_beyond_end' | 'air_too_short' | 'fades_too_long'
  >;
  field: 'cue_in_ms' | 'cue_out_ms' | 'fade_out_ms';
}

const FADE_VALIDATORS = [
  Validators.required,
  rangeValidator({ min: 0, max: CUE_LIMITS.fadeMaxMs }),
];

export function cueForm(durationMs: () => number | null): CueForm {
  return new FormGroup(
    {
      cue_in_ms: new FormControl<number | null>(0, [Validators.required, Validators.min(0)]),
      cue_out_ms: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
      fade_in_ms: new FormControl<number | null>(0, FADE_VALIDATORS),
      fade_out_ms: new FormControl<number | null>(0, FADE_VALIDATORS),
      reviewed: new FormControl(true, { nonNullable: true }),
    },
    { validators: cueValidator(durationMs) },
  );
}

export function cueFormValue(track: Track): CueForm['value'] {
  return {
    cue_in_ms: track.cue_in_ms,
    cue_out_ms: track.cue_out_ms ?? track.duration_ms ?? null,
    fade_in_ms: track.fade_in_ms,
    fade_out_ms: track.fade_out_ms,
    reviewed: true,
  };
}

export function cueBody(form: CueForm, durationMs: number): TrackCueBody {
  const value = form.getRawValue();
  const out = value.cue_out_ms ?? durationMs;
  return {
    cue_in_ms: value.cue_in_ms ?? 0,
    cue_out_ms: out >= durationMs ? null : out,
    fade_in_ms: value.fade_in_ms ?? 0,
    fade_out_ms: value.fade_out_ms ?? 0,
  };
}

/**
 * The rules of `set-track-cue` across fields (backend phase 22 §3.3, §10): the order of the
 * points, the file edge, at least 5 s on air for a cut, and fades that fit. The backend checks
 * again; its field errors go on the controls.
 */
export function cueValidator(durationMs: () => number | null): ValidatorFn {
  return (group: AbstractControl) => {
    const duration = durationMs();
    const value = (group as CueForm).getRawValue();
    const {
      cue_in_ms: cueIn,
      cue_out_ms: cueOut,
      fade_in_ms: fadeIn,
      fade_out_ms: fadeOut,
    } = value;
    if (duration === null || cueIn === null || cueOut === null) {
      return null;
    }
    const error = (code: CueError['code'], field: CueError['field']) => ({
      cue: { code, field } satisfies CueError,
    });
    if (cueIn >= duration) {
      return error('cue_beyond_end', 'cue_in_ms');
    }
    if (cueOut <= cueIn) {
      return error('cue_order', 'cue_out_ms');
    }
    if (cueOut > duration) {
      return error('cue_beyond_end', 'cue_out_ms');
    }
    const air = cueOut - cueIn;
    const cutsEnd = cueOut < duration;
    if ((cueIn > 0 || cutsEnd) && air < CUE_LIMITS.minAirMs) {
      return error('air_too_short', cutsEnd ? 'cue_out_ms' : 'cue_in_ms');
    }
    if ((fadeIn ?? 0) + (fadeOut ?? 0) > air) {
      return error('fades_too_long', 'fade_out_ms');
    }
    return null;
  };
}

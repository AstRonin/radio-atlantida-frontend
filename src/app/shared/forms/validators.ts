import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Validators that mirror the backend's DTO rules (design §6.2). The backend checks again; these
 * only give feedback before sending. Each error key has a text in `forms.errors.<key>`.
 */

export interface RangeRule {
  min: number;
  max: number;
  /** Allowed increment from `min`; 1 for whole numbers. */
  step?: number;
}

export interface RangeError {
  min: number;
  max: number;
  step?: number;
}

/** A number within `min`..`max` and on a `step` from `min`. Empty values pass; use `required`. */
export function rangeValidator(rule: RangeRule): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const number = typeof value === 'number' ? value : Number(value);
    const error: RangeError = { min: rule.min, max: rule.max, step: rule.step };
    if (!Number.isFinite(number) || number < rule.min || number > rule.max) {
      return { range: error };
    }
    if (rule.step !== undefined && !onStep(number - rule.min, rule.step)) {
      return { step: error };
    }
    return null;
  };
}

// Compared with a tolerance, so 0.1 steps are not rejected for binary rounding.
function onStep(offset: number, step: number): boolean {
  const steps = offset / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM`, 00:00 to 23:59, as play rule windows are sent. Empty values pass. */
export const timeOfDayValidator: ValidatorFn = (control) => {
  const value: unknown = control.value;
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return typeof value === 'string' && TIME_OF_DAY.test(value) ? null : { timeOfDay: true };
};

/** A set of weekdays, 1 = Monday to 7 = Sunday, without repeats. Empty or null passes. */
export const weekdaysValidator: ValidatorFn = (control) => {
  const value: unknown = control.value;
  if (value === null || value === undefined) {
    return null;
  }
  const valid =
    Array.isArray(value) &&
    value.every((day: unknown) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7) &&
    new Set(value).size === value.length;
  return valid ? null : { weekdays: true };
};

/**
 * A file path relative to the media root, as `TrackBody.file_path` requires: forward slashes, no
 * absolute path (`/x`, `C:/x`), no backslash, and no `..` element. The backend rejects these again.
 * Empty values pass; use `required`.
 */
export const relativePathValidator: ValidatorFn = (control) => {
  const value: unknown = control.value;
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return { relativePath: true };
  }
  const absolute = value.startsWith('/') || /^[A-Za-z]:/.test(value);
  const escapes = value.split('/').includes('..');
  return absolute || escapes || value.includes('\\') ? { relativePath: true } : null;
};

/**
 * A list with at least one entry, for example the playlists of a clock element or the hours of a
 * grid change. The error is `required`, so the message is "This field is required."
 */
export const nonEmptyValidator: ValidatorFn = (control) => {
  const value: unknown = control.value;
  return Array.isArray(value) && value.length > 0 ? null : { required: true };
};

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Group validator: the named fields are all set or all empty, as the play rule window
 * (`window_from` with `window_to`). The error is on the group and on each empty field.
 */
export function bothOrNoneValidator(fields: readonly string[]): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const controls = fields.map((name) => group.get(name));
    const set = controls.filter((control) => control && !isEmpty(control.value)).length;
    const ok = set === 0 || set === fields.length;
    for (const control of controls) {
      if (control) {
        markMissing(control, 'bothOrNone', !ok && isEmpty(control.value));
      }
    }
    return ok ? null : { bothOrNone: { fields } };
  };
}

/**
 * Group validator: at least one of the named fields is set, as for the constraints of a play rule
 * (design §7.3). The error is on the group, since no single field is wrong.
 */
export function atLeastOneValidator(fields: readonly string[]): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const set = fields.some((name) => {
      const control = group.get(name);
      return control !== null && !isEmpty(control.value);
    });
    return set ? null : { atLeastOne: { fields } };
  };
}

/**
 * Group validator: two station dates (`YYYY-MM-DD`) form a range of 1 to `maxDays` days, the last
 * on or after the first, as the track plan range (at most 7 days). The error is on the group and
 * on the `to` control.
 */
export function dateRangeValidator(from: string, to: string, maxDays: number): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const first: unknown = group.get(from)?.value;
    const last = group.get(to);
    const value: unknown = last?.value;
    if (!last || typeof first !== 'string' || typeof value !== 'string' || !first || !value) {
      return null;
    }
    const days = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
    const ok = days >= 0 && days < maxDays;
    markMissing(last, 'dateRange', !ok, { maxDays });
    return ok ? null : { dateRange: { maxDays } };
  };
}

// A group validator may add or clear an error on a child, without touching the child's own errors.
function markMissing(
  control: AbstractControl,
  key: string,
  missing: boolean,
  detail: unknown = true,
): void {
  const has = control.hasError(key);
  if (missing === has) {
    return;
  }
  const others = Object.entries(control.errors ?? {}).filter(([name]) => name !== key);
  const errors: ValidationErrors = Object.fromEntries(
    missing ? [...others, [key, detail]] : others,
  );
  control.setErrors(Object.keys(errors).length > 0 ? errors : null, { emitEvent: false });
}

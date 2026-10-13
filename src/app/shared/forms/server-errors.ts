import { AbstractControl } from '@angular/forms';
import type { FieldError, FieldErrorCode } from '../../core/api/api-types';

/** Key of the validation error that holds a backend field error on a control. */
export const SERVER_ERROR = 'server';

export interface ServerFieldError {
  code: FieldErrorCode;
  /** English text for developers; the panel shows a translation of `code`. */
  message: string;
}

/**
 * Puts the backend's per-field errors on the matching controls (design §6.2). Control names must
 * match the DTO's JSON names, so `elements[2].fixed_minute` resolves to
 * `form.get(['elements', 2, 'fixed_minute'])`. The error clears when the control's value changes,
 * because Angular re-runs the validators then.
 *
 * Returns the errors that match no control (including `query.` and `path.` parameters), so the
 * caller can show them with the form.
 */
export function applyServerErrors(
  form: AbstractControl,
  errors: readonly FieldError[],
): FieldError[] {
  const unmatched: FieldError[] = [];
  for (const error of errors) {
    const path = controlPath(error.field);
    const control = path ? form.get(path) : null;
    if (!control) {
      unmatched.push(error);
      continue;
    }
    const serverError: ServerFieldError = { code: error.code, message: error.message };
    control.setErrors({ ...control.errors, [SERVER_ERROR]: serverError });
    control.markAsTouched();
  }
  return unmatched;
}

/** `elements[2].fixed_minute` -> `['elements', 2, 'fixed_minute']`; null if it is not a body field. */
export function controlPath(field: string): (string | number)[] | null {
  if (field === '' || field.startsWith('query.') || field.startsWith('path.')) {
    return null;
  }
  const path: (string | number)[] = [];
  for (const segment of field.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(segment);
    if (!match) {
      return null;
    }
    path.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) {
      path.push(Number(index[1]));
    }
  }
  return path;
}

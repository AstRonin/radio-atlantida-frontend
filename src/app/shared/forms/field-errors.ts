import { Signal, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { SERVER_ERROR, ServerFieldError } from './server-errors';

// The first matching key wins, so the most useful message is shown when several apply.
const ORDER = [
  SERVER_ERROR,
  'required',
  'range',
  'step',
  'min',
  'max',
  'minlength',
  'maxlength',
  'timeOfDay',
  'weekdays',
  'bothOrNone',
  'relativePath',
  'pattern',
];

/**
 * The plain-language message for a control's errors (design §6.2), for example "Enter a number
 * between 1 and 3600." Backend field errors are translated by their code. Null when valid.
 */
export function fieldErrorMessage(
  errors: ValidationErrors | null,
  i18n: I18nService,
): string | null {
  if (!errors) {
    return null;
  }
  const keys = Object.keys(errors);
  const key = ORDER.find((name) => keys.includes(name)) ?? keys[0];
  if (key === undefined) {
    return null;
  }
  const detail: unknown = errors[key];

  if (key === SERVER_ERROR) {
    const server = detail as ServerFieldError;
    const codeKey = `forms.serverErrors.${server.code}`;
    return i18n.has(codeKey) ? i18n.translate(codeKey) : server.message;
  }
  if (key === 'range' || key === 'step') {
    const range = detail as { min: number; max: number; step?: number };
    const params = { min: format(range.min, i18n), max: format(range.max, i18n) };
    if (key === 'step' && range.step !== undefined) {
      return i18n.translate('forms.errors.step', { ...params, step: format(range.step, i18n) });
    }
    return i18n.translate('forms.errors.range', params);
  }
  if (key === 'min' || key === 'max') {
    const limit = detail as { min?: number; max?: number };
    const value = key === 'min' ? limit.min : limit.max;
    return i18n.translate(`forms.errors.${key}`, { value: format(value ?? 0, i18n) });
  }
  if (key === 'minlength' || key === 'maxlength') {
    const length = detail as { requiredLength: number };
    return i18n.translate(`forms.errors.${key}`, { length: length.requiredLength });
  }
  const textKey = `forms.errors.${key}`;
  return i18n.has(textKey) ? i18n.translate(textKey) : i18n.translate('forms.errors.invalid');
}

/**
 * The message of a control as a signal. Reactive forms do not notify OnPush views, so this listens
 * to the control's events: a validator result, `applyServerErrors()`, or a touch updates it.
 * Shown only once the control is touched, like `mat-error`. Call in an injection context.
 */
export function controlErrorMessage(control: Signal<AbstractControl>): Signal<string | null> {
  const i18n = inject(I18nService);
  const version = controlVersion(control);
  return computed(() => {
    version();
    const current = control();
    return current.touched ? fieldErrorMessage(current.errors, i18n) : null;
  });
}

/**
 * A counter that changes on every event of the control (value, status, touched, pristine), so a
 * `computed` or template that reads it re-evaluates. Call in an injection context.
 */
export function controlVersion(control: Signal<AbstractControl>): Signal<number> {
  return toSignal(
    toObservable(control).pipe(
      switchMap((current) => current.events.pipe(startWith(null))),
      map((_, index) => index),
    ),
    { initialValue: 0 },
  );
}

function format(value: number, i18n: I18nService): string {
  return new Intl.NumberFormat(i18n.locale()).format(value);
}

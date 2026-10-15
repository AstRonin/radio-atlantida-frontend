import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import type { ElementFillerMode } from '../../shared/forms/filler-mode-select.component';
import { nonEmptyValidator, rangeValidator } from '../../shared/forms/validators';

export type Clock = ApiSchema<'Clock'>;
export type ClockBody = ApiSchema<'ClockBody'>;
export type ClockElement = ApiSchema<'ClockElement'>;
export type ClockElementBody = ApiSchema<'ClockElementBody'>;
export type ClockSaveResult = ApiSchema<'ClockSaveResult'>;
export type Placement = ClockElementBody['placement'] & string;

export const PLACEMENTS: readonly Placement[] = ['flow', 'start', 'end', 'fixed'];

/** Limits of `ClockBody` and `ClockElementBody`. */
export const CLOCK_LIMITS = {
  nameMax: 200,
  elementsMax: 200,
  minuteMax: 59,
  toleranceMax: 600_000,
  durationMax: 3_600_000,
} as const;

/** A new element: three and a half minutes of music in flow is the most common case. */
export const NEW_ELEMENT_DURATION_MS = 210_000;

export type ElementForm = FormGroup<{
  /** An existing element of the clock; null for a new one (design §7.2, replacement). */
  id: FormControl<number | null>;
  placement: FormControl<Placement>;
  fixed_minute: FormControl<number | null>;
  fixed_tolerance_ms: FormControl<number | null>;
  nominal_duration_ms: FormControl<number | null>;
  duration_tolerance_ms: FormControl<number | null>;
  playlist_ids: FormControl<number[] | null>;
  filler_mode: FormControl<ElementFillerMode | null>;
  filler_source_id: FormControl<number | null>;
}>;

// Control names are the DTO's JSON names, so `elements[2].fixed_minute` lands on its control.
export type ClockForm = FormGroup<{
  name: FormControl<string | null>;
  default_filler_mode: FormControl<ElementFillerMode | null>;
  default_filler_source_id: FormControl<number | null>;
  elements: FormArray<ElementForm>;
}>;

export function needsSource(mode: ElementFillerMode | null | undefined): boolean {
  return mode === 'playlist' || mode === 'artist';
}

/**
 * The clock form. Fields that apply only to some choices (the fixed minute, a filler source) are
 * disabled otherwise, so their validators do not block the save and they are not sent.
 */
export function clockForm(destroyRef: DestroyRef): ClockForm {
  const form: ClockForm = new FormGroup({
    name: new FormControl<string | null>('', [
      Validators.required,
      Validators.maxLength(CLOCK_LIMITS.nameMax),
    ]),
    default_filler_mode: new FormControl<ElementFillerMode | null>(null),
    default_filler_source_id: new FormControl<number | null>({ value: null, disabled: true }),
    elements: new FormArray<ElementForm>([], nonEmptyValidator),
  });
  linkSource(form.controls.default_filler_mode, form.controls.default_filler_source_id, destroyRef);
  return form;
}

export function elementForm(destroyRef: DestroyRef, element?: ClockElement): ElementForm {
  const group: ElementForm = new FormGroup({
    id: new FormControl<number | null>(element?.id ?? null),
    placement: new FormControl<Placement>(element?.placement ?? 'flow', { nonNullable: true }),
    fixed_minute: new FormControl<number | null>(element?.fixed_minute ?? null, [
      Validators.required,
      rangeValidator({ min: 0, max: CLOCK_LIMITS.minuteMax, step: 1 }),
    ]),
    fixed_tolerance_ms: new FormControl<number | null>(
      element?.fixed_tolerance_ms ?? null,
      rangeValidator({ min: 0, max: CLOCK_LIMITS.toleranceMax, step: 1 }),
    ),
    nominal_duration_ms: new FormControl<number | null>(
      element?.nominal_duration_ms ?? NEW_ELEMENT_DURATION_MS,
      [Validators.required, rangeValidator({ min: 1, max: CLOCK_LIMITS.durationMax, step: 1 })],
    ),
    duration_tolerance_ms: new FormControl<number | null>(
      element?.duration_tolerance_ms ?? null,
      rangeValidator({ min: 0, max: CLOCK_LIMITS.toleranceMax, step: 1 }),
    ),
    playlist_ids: new FormControl<number[] | null>(element?.playlist_ids ?? [], nonEmptyValidator),
    filler_mode: new FormControl<ElementFillerMode | null>(
      element?.filler_mode ?? 'none',
      Validators.required,
    ),
    filler_source_id: new FormControl<number | null>(element?.filler_source_id ?? null, [
      Validators.required,
    ]),
  });

  const syncFixed = (placement: Placement) => {
    for (const control of [group.controls.fixed_minute, group.controls.fixed_tolerance_ms]) {
      if (placement === 'fixed') {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    group.updateValueAndValidity();
  };
  syncFixed(group.controls.placement.value);
  group.controls.placement.valueChanges
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe((placement) => syncFixed(placement));
  linkSource(group.controls.filler_mode, group.controls.filler_source_id, destroyRef);
  return group;
}

/** Enables the source control only for the playlist and artist modes, and clears it on a change. */
function linkSource(
  mode: FormControl<ElementFillerMode | null>,
  source: FormControl<number | null>,
  destroyRef: DestroyRef,
): void {
  const sync = (value: ElementFillerMode | null) => {
    if (needsSource(value)) {
      source.enable({ emitEvent: false });
    } else {
      source.disable({ emitEvent: false });
    }
    source.setValidators(needsSource(value) ? Validators.required : null);
    source.updateValueAndValidity();
  };
  sync(mode.value);
  mode.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((value) => {
    source.setValue(null, { emitEvent: false });
    source.markAsUntouched();
    sync(value);
  });
}

/** Puts a stored clock into the form, replacing its elements. */
export function fillClockForm(form: ClockForm, clock: Clock, destroyRef: DestroyRef): void {
  const elements = form.controls.elements;
  elements.clear({ emitEvent: false });
  for (const element of clock.elements) {
    elements.push(elementForm(destroyRef, element), { emitEvent: false });
  }
  form.controls.name.setValue(clock.name);
  form.controls.default_filler_mode.setValue(clock.default_filler_mode ?? null);
  form.controls.default_filler_source_id.setValue(clock.default_filler_source_id ?? null);
  form.updateValueAndValidity();
  form.markAsPristine();
  form.markAsUntouched();
}

/**
 * The request body. Empty tolerances are left out, so the backend applies its default settings;
 * fields of other placements and modes are not sent.
 */
export function clockBody(form: ClockForm): ClockBody {
  const value = form.getRawValue();
  const defaultMode = value.default_filler_mode;
  const isDefaultMode = defaultMode === 'random' || needsSource(defaultMode);
  return {
    name: (value.name ?? '').trim(),
    default_filler_mode: isDefaultMode ? (defaultMode as 'random' | 'playlist' | 'artist') : null,
    ...(needsSource(defaultMode) && value.default_filler_source_id !== null
      ? { default_filler_source_id: value.default_filler_source_id }
      : {}),
    elements: form.controls.elements.controls.map(elementBody),
  };
}

function elementBody(group: ElementForm): ClockElementBody {
  const value = group.getRawValue();
  const fixed = value.placement === 'fixed';
  const mode = value.filler_mode ?? 'none';
  return {
    ...(value.id !== null ? { id: value.id } : {}),
    placement: value.placement,
    ...(fixed && value.fixed_minute !== null ? { fixed_minute: value.fixed_minute } : {}),
    ...(fixed && value.fixed_tolerance_ms !== null
      ? { fixed_tolerance_ms: value.fixed_tolerance_ms }
      : {}),
    nominal_duration_ms: value.nominal_duration_ms ?? 0,
    ...(value.duration_tolerance_ms !== null
      ? { duration_tolerance_ms: value.duration_tolerance_ms }
      : {}),
    playlist_ids: value.playlist_ids ?? [],
    filler_mode: mode,
    ...(needsSource(mode) && value.filler_source_id !== null
      ? { filler_source_id: value.filler_source_id }
      : {}),
  };
}

/** Minute and second of the hour, `mm:ss`, so 60:00 is the end of the hour. */
export function hourOffset(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import { HOUR_OFFSET_MAX_MS } from '../../core/time/duration';
import { ClockRule, linkClockCount } from '../../shared/forms/clock-rule-input.component';
import { rangeValidator } from '../../shared/forms/validators';

export type Clock = ApiSchema<'Clock'>;
export type ClockBody = ApiSchema<'ClockBody'>;
export type ClockPlaylistBody = ApiSchema<'ClockPlaylistBody'>;
export type ClockInsertBody = ApiSchema<'ClockInsertBody'>;
export type ClockSaveResult = ApiSchema<'ClockSaveResult'>;
export type Playlist = ApiSchema<'Playlist'>;

/** Limits of `ClockBody`, `ClockPlaylistBody`, and `ClockInsertBody`. */
export const CLOCK_LIMITS = {
  nameMax: 200,
  playlistsMax: 100,
  insertsMax: 100,
  weight: { min: 1, max: 100 },
  /** Insert tolerance in seconds (0 to 600 000 ms). */
  toleranceSeconds: { min: 0, max: 600 },
} as const;

/** The start tolerance of a new insert when the setting is not loaded: ±1 minute. */
export const DEFAULT_INSERT_TOLERANCE_MS = 60_000;

export type InsertSource = 'track' | 'playlist';

export type PlaylistRowForm = FormGroup<{
  playlist_id: FormControl<number>;
  /** The playlist's own rule, shown and used while the clock does not override it; not sent. */
  inherited_rule: FormControl<ClockRule>;
  inherited_count: FormControl<number | null>;
  /** Whether this clock overrides the playlist's rule; not sent. */
  override: FormControl<boolean>;
  clock_rule: FormControl<ClockRule | null>;
  clock_count: FormControl<number | null>;
  fill_weight: FormControl<number | null>;
}>;

export type InsertForm = FormGroup<{
  offset_ms: FormControl<number | null>;
  tolerance_ms: FormControl<number | null>;
  /** Whether the insert plays one track or a track drawn from a playlist; not sent. */
  source: FormControl<InsertSource>;
  /** The track picker's value: one ID at most. */
  track_id: FormControl<number[] | null>;
  playlist_id: FormControl<number | null>;
}>;

// Control names are the DTO's JSON names, so `inserts[1].offset_ms` lands on its control.
export type ClockForm = FormGroup<{
  name: FormControl<string | null>;
  playlists: FormArray<PlaylistRowForm>;
  inserts: FormArray<InsertForm>;
}>;

/** The rule a row has in this clock: the override, else the playlist's own. */
export function effectiveRule(row: PlaylistRowForm): ClockRule {
  const { override, clock_rule, inherited_rule } = row.getRawValue();
  return override && clock_rule !== null ? clock_rule : inherited_rule;
}

/**
 * Mirrors the clock rules the backend checks on the rows together (design §7.2): at least one
 * fill playlist (`fillPlaylistRequired`), and shares on every fill playlist or on none
 * (`fillWeightsPartial`).
 */
export const clockPlaylistsValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const rows = (control as FormArray<PlaylistRowForm>).controls;
  if (rows.length === 0) {
    return null;
  }
  const fill = rows.filter((row) => effectiveRule(row) === 'fill');
  if (fill.length === 0) {
    return { fillPlaylistRequired: true };
  }
  const weighted = fill.filter((row) => row.controls.fill_weight.value !== null).length;
  return weighted > 0 && weighted < fill.length ? { fillWeightsPartial: true } : null;
};

/** An insert plays a track or a playlist: the chosen source must be set. */
const insertSourceValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const insert = control as InsertForm;
  const { source, track_id, playlist_id } = insert.getRawValue();
  const missing = source === 'track' ? (track_id ?? []).length === 0 : playlist_id === null;
  return missing ? { insertSource: true } : null;
};

export function clockForm(): ClockForm {
  return new FormGroup({
    name: new FormControl<string | null>('', [
      Validators.required,
      Validators.maxLength(CLOCK_LIMITS.nameMax),
    ]),
    playlists: new FormArray<PlaylistRowForm>([], [Validators.required, clockPlaylistsValidator]),
    inserts: new FormArray<InsertForm>([]),
  });
}

/**
 * A playlist row. The override fields are enabled only while the override is on, and the share
 * only while the row fills the hour, so a field that does not apply is neither checked nor sent.
 */
export function playlistRowForm(
  destroyRef: DestroyRef,
  playlist: Pick<Playlist, 'id' | 'clock_rule' | 'clock_count'>,
  stored?: ApiSchema<'ClockPlaylist'>,
): PlaylistRowForm {
  const override = stored?.clock_rule !== undefined;
  const row: PlaylistRowForm = new FormGroup({
    playlist_id: new FormControl(playlist.id, { nonNullable: true }),
    inherited_rule: new FormControl(playlist.clock_rule, { nonNullable: true }),
    inherited_count: new FormControl<number | null>(playlist.clock_count ?? null),
    override: new FormControl(override, { nonNullable: true }),
    clock_rule: new FormControl<ClockRule | null>(stored?.clock_rule ?? null, Validators.required),
    clock_count: new FormControl<number | null>(stored?.clock_count ?? null),
    fill_weight: new FormControl<number | null>(
      stored?.fill_weight ?? null,
      rangeValidator({ ...CLOCK_LIMITS.weight, step: 1 }),
    ),
  });
  const {
    override: toggle,
    clock_rule,
    clock_count,
    inherited_rule,
    inherited_count,
  } = row.controls;
  linkClockCount(clock_rule, clock_count, destroyRef);

  const syncOverride = (on: boolean, fromToggle: boolean) => {
    if (on) {
      clock_rule.enable({ emitEvent: false });
      if (fromToggle) {
        // An override starts from the playlist's own rule, so only the change has to be made.
        clock_count.setValue(inherited_count.value, { emitEvent: false });
        clock_rule.setValue(inherited_rule.value);
      }
    } else {
      // A null rule disables the count through linkClockCount.
      clock_rule.setValue(null);
      clock_rule.disable({ emitEvent: false });
    }
    syncWeight();
  };
  const syncWeight = () => {
    const weight = row.controls.fill_weight;
    if (effectiveRule(row) === 'fill') {
      weight.enable({ emitEvent: false });
    } else {
      weight.setValue(null, { emitEvent: false });
      weight.disable({ emitEvent: false });
    }
    row.updateValueAndValidity();
  };
  syncOverride(override, false);
  toggle.valueChanges
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe((on) => syncOverride(on, true));
  clock_rule.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(syncWeight);
  return row;
}

/** An insert row; the source not chosen is disabled, so only one of track and playlist is sent. */
export function insertForm(
  destroyRef: DestroyRef,
  insert?: Partial<ApiSchema<'ClockInsert'>>,
  defaultToleranceMs = DEFAULT_INSERT_TOLERANCE_MS,
): InsertForm {
  const group: InsertForm = new FormGroup(
    {
      offset_ms: new FormControl<number | null>(insert?.offset_ms ?? null, [
        Validators.required,
        rangeValidator({ min: 0, max: HOUR_OFFSET_MAX_MS, step: 1000 }),
      ]),
      tolerance_ms: new FormControl<number | null>(
        insert?.tolerance_ms ?? defaultToleranceMs,
        Validators.required,
      ),
      source: new FormControl<InsertSource>(
        insert?.playlist_id !== undefined ? 'playlist' : 'track',
        { nonNullable: true },
      ),
      track_id: new FormControl<number[] | null>(
        insert?.track_id !== undefined ? [insert.track_id] : [],
      ),
      playlist_id: new FormControl<number | null>(insert?.playlist_id ?? null),
    },
    { validators: insertSourceValidator },
  );
  const sync = (source: InsertSource) => {
    const [on, off] =
      source === 'track'
        ? [group.controls.track_id, group.controls.playlist_id]
        : [group.controls.playlist_id, group.controls.track_id];
    on.enable({ emitEvent: false });
    off.disable({ emitEvent: false });
    group.updateValueAndValidity();
  };
  sync(group.controls.source.value);
  group.controls.source.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(sync);
  return group;
}

/**
 * Puts a stored clock into the form, replacing its rows. The playlists' own rules come from the
 * catalog; a playlist missing there (deleted meanwhile) keeps the effective rule as its own.
 */
export function fillClockForm(
  form: ClockForm,
  clock: Clock,
  playlists: ReadonlyMap<number, Playlist>,
  destroyRef: DestroyRef,
): void {
  const rows = form.controls.playlists;
  rows.clear({ emitEvent: false });
  for (const stored of clock.playlists) {
    const playlist = playlists.get(stored.playlist_id) ?? {
      id: stored.playlist_id,
      clock_rule: stored.effective_rule,
      clock_count: stored.effective_count,
    };
    rows.push(playlistRowForm(destroyRef, playlist, stored), { emitEvent: false });
  }
  const inserts = form.controls.inserts;
  inserts.clear({ emitEvent: false });
  for (const insert of [...clock.inserts].sort((a, b) => a.offset_ms - b.offset_ms)) {
    inserts.push(insertForm(destroyRef, insert), { emitEvent: false });
  }
  form.controls.name.setValue(clock.name);
  form.updateValueAndValidity();
  form.markAsPristine();
  form.markAsUntouched();
}

/**
 * The request body. Rows send only what they set: no override means the playlist's own rule, an
 * empty share or tolerance is left out so the backend applies its default.
 */
export function clockBody(form: ClockForm): ClockBody {
  const value = form.getRawValue();
  return {
    name: (value.name ?? '').trim(),
    playlists: form.controls.playlists.controls.map(playlistBody),
    inserts: form.controls.inserts.controls.map(insertBody),
  };
}

function playlistBody(row: PlaylistRowForm): ClockPlaylistBody {
  const value = row.getRawValue();
  const rule = value.override ? value.clock_rule : null;
  return {
    playlist_id: value.playlist_id,
    ...(rule !== null ? { clock_rule: rule } : {}),
    ...(rule === 'spread' && value.clock_count !== null ? { clock_count: value.clock_count } : {}),
    ...(effectiveRule(row) === 'fill' && value.fill_weight !== null
      ? { fill_weight: value.fill_weight }
      : {}),
  };
}

function insertBody(group: InsertForm): ClockInsertBody {
  const value = group.getRawValue();
  const trackId = value.track_id?.[0];
  return {
    offset_ms: value.offset_ms ?? 0,
    ...(value.tolerance_ms !== null ? { tolerance_ms: value.tolerance_ms } : {}),
    ...(value.source === 'track' && trackId !== undefined ? { track_id: trackId } : {}),
    ...(value.source === 'playlist' && value.playlist_id !== null
      ? { playlist_id: value.playlist_id }
      : {}),
  };
}

/** The share of each fill row in percent, or null for rows without one. */
export function fillShares(rows: readonly PlaylistRowForm[]): (number | null)[] {
  const weights = rows.map((row) =>
    effectiveRule(row) === 'fill' ? row.controls.fill_weight.value : null,
  );
  const total = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
  return weights.map((weight) =>
    weight === null || total === 0 ? null : Math.round((weight / total) * 100),
  );
}

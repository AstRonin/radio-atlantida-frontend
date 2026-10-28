import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import {
  noControlCharacters,
  notBlankValidator,
  rangeValidator,
  relativePathValidator,
} from '../../shared/forms/validators';

export type Track = ApiSchema<'Track'>;
export type TrackBody = ApiSchema<'TrackBody'>;
export type UpdateTrackBody = ApiSchema<'UpdateTrackBody'>;

/** Limits of `TrackBody`. */
export const TRACK_LIMITS = {
  titleMax: 500,
  pathMax: 1024,
  notesMax: 2000,
  /** Six hours. */
  durationMaxMs: 21_600_000,
} as const;

/** The title rule of the backend, on the edit page and in the rename dialog. */
export const TITLE_VALIDATORS: ValidatorFn[] = [
  Validators.required,
  notBlankValidator,
  Validators.maxLength(TRACK_LIMITS.titleMax),
  noControlCharacters,
];

/** Trimmed, with runs of white space as one space, as the backend stores a title. */
export function cleanTitle(title: string | null): string {
  return (title ?? '').trim().replace(/\s+/g, ' ');
}

export type TrackForm = ReturnType<typeof trackForm>;

/**
 * The track form; control names are the DTO's JSON names. `rule_ids` is the body of
 * `PUT /api/tracks/{id}/play-rules`, sent after the track itself.
 */
export function trackForm() {
  return new FormGroup({
    title: new FormControl<string | null>('', TITLE_VALIDATORS),
    artist_id: new FormControl<number | null>(null),
    type_id: new FormControl<number | null>(null, Validators.required),
    file_path: new FormControl<string | null>('', [
      Validators.required,
      Validators.maxLength(TRACK_LIMITS.pathMax),
      relativePathValidator,
    ]),
    duration_ms: new FormControl<number | null>(
      null,
      rangeValidator({ min: 1, max: TRACK_LIMITS.durationMaxMs, step: 1 }),
    ),
    quality_notes: new FormControl<string | null>('', Validators.maxLength(TRACK_LIMITS.notesMax)),
    /** Overrides the analysis result until the next analysis; null keeps it unset. */
    quality_ok: new FormControl<boolean | null>(null),
    playlist_ids: new FormControl<number[] | null>([]),
    rule_ids: new FormControl<number[] | null>([]),
  });
}

export function trackFormValue(track: Track): TrackForm['value'] {
  return {
    title: track.title,
    artist_id: track.artist?.id ?? null,
    type_id: track.type.id,
    file_path: track.file_path,
    duration_ms: track.duration_ms ?? null,
    quality_notes: track.quality_notes,
    quality_ok: track.quality_ok ?? null,
    playlist_ids: track.playlist_ids,
    rule_ids: track.play_rule_ids,
  };
}

/**
 * Edit mode: a stored track's file path and length are not edited here. Their controls are
 * disabled, so they are left out of the validity, and the page shows them read-only. The file
 * changes only through Replace file (`POST /api/tracks/{id}/replace-file`); the update body has
 * neither field.
 */
export function resetStoredForm(form: TrackForm, track: Track): void {
  form.reset(trackFormValue(track));
  form.controls.file_path.disable();
  form.controls.duration_ms.disable();
}

/** The body of `POST /api/tracks`: the backend reads the file's facts from the path. */
export function createTrackBody(form: TrackForm): TrackBody {
  const value = form.getRawValue();
  return {
    title: cleanTitle(value.title),
    artist_id: value.artist_id,
    type_id: value.type_id ?? 0,
    file_path: (value.file_path ?? '').trim(),
    duration_ms: value.duration_ms,
    quality_notes: (value.quality_notes ?? '').trim(),
    playlist_ids: value.playlist_ids ?? [],
  };
}

/**
 * The body of `PUT /api/tracks/{id}`: metadata and playlists only. The file path, the length and
 * the file facts are refused there (unknown_field); the analysis and Replace file set them.
 */
export function updateTrackBody(form: TrackForm): UpdateTrackBody {
  const value = form.getRawValue();
  return {
    title: cleanTitle(value.title),
    artist_id: value.artist_id,
    type_id: value.type_id ?? 0,
    quality_ok: value.quality_ok,
    quality_notes: (value.quality_notes ?? '').trim(),
    playlist_ids: value.playlist_ids ?? [],
  };
}

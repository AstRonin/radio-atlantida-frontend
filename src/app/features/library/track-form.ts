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
 * The request body. The update replaces every field, so the file facts this page does not edit
 * (format, bitrate, sample rate; the analysis sets them) are sent back as stored, with the quality
 * flag from the form. On create they are left out, and the backend reads them from the file.
 */
export function trackBody(form: TrackForm, stored: Track | null): TrackBody {
  const value = form.getRawValue();
  return {
    title: cleanTitle(value.title),
    artist_id: value.artist_id,
    type_id: value.type_id ?? 0,
    file_path: (value.file_path ?? '').trim(),
    duration_ms: value.duration_ms,
    quality_notes: (value.quality_notes ?? '').trim(),
    playlist_ids: value.playlist_ids ?? [],
    ...(stored && {
      format: stored.format ?? null,
      bitrate: stored.bitrate ?? null,
      sample_rate: stored.sample_rate ?? null,
      quality_ok: value.quality_ok,
    }),
  };
}

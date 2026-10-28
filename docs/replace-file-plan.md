# Replace track file: frontend plan

Companion to `backend/docs/replace-file-plan.md`. The backend part (endpoint, validation, in-use refusal, PUT without analysis fields) must be merged and its `api/openapi.json` regenerated first. The frontend then syncs the types with `npm run api:sync`.

## Goal

On the Edit track page, the file path and the length are no longer edited in the form. The file is changed through one explicit action, Replace file. The action opens a dialog with a path field, calls the backend, and shows the result.

## Current state (verified in the frontend, read-only)

- `src/app/features/library/track-edit.component.ts`: the form has File path (lines 132-140) and Length (lines 141-158). The File block (lines 172-219) renders `app-track-analysis`, which shows Format, Bitrate, Sample rate and Channels.
- `src/app/features/library/track-form.ts`: `trackForm()` (lines 43-54) builds the controls, including `file_path` (required, maxLength 1024, `relativePathValidator`) and `duration_ms`. `trackBody()` (lines 82-98) sends `file_path`, `duration_ms`, `format`, `bitrate` and `sample_rate` back in the PUT. The comment at lines 77-81 says the PUT replaces every field.
- `save()` (`track-edit.component.ts:385-428`) sends `PUT /api/tracks/{id}` and then the play rules. Errors go through `applySubmitError`.
- Types are generated: `src/app/core/api/generated/api.ts` from `api/openapi.json`, aliased in `src/app/core/api/api-types.ts` (`ApiSchema<'TrackBody'>`, `ApiSchema<'Track'>`). Types are never written by hand.
- Dialog pattern to copy: `src/app/features/artists/artist-dialog.component.ts` (a form dialog with `applySubmitError`). Opened with `MatDialog.open(...)`, `afterClosed().pipe(takeUntilDestroyed())`, as in `library-page.component.ts:974-1003`.
- Refusal display: `ApiProblem.used_by` is shown by `src/app/shared/ui/used-by-list.component.ts`. The confirm dialog pattern is in `src/app/shared/ui/confirm.service.ts`.
- Field errors: `applySubmitError` (`src/app/shared/forms/server-errors.ts:75-80`) maps `ApiProblem.errors` onto controls.
- Reviewed mark (`track-edit.component.ts:182-198`) is disabled while the form is dirty, with the hint "Save the changes first". The replace button follows the same rule.
- Cue reset note: `cueResetNote` (`src/app/features/library/track-media.ts:89-92`), shown at `track-edit.component.ts:213-217`.
- Tests: `src/app/features/library/library.spec.ts` (request body, validation), `library-media.spec.ts`, `track-cue.spec.ts`. Runner is the Angular unit-test builder with Vitest.

## Frontend changes

### 1. Edit page: file path and length are read-only

- On an existing track, `file_path` and `duration_ms` are shown as read-only text (the path, and length formatted as `ms` and `m:ss` with `formatDurationMs`). They are not form controls.
- On a new track (create), the same fields stay editable as now. The create flow is unchanged.
- `trackForm()` and the validators stay for create. The edit path does not build those controls.

### 2. Request body without the analysis fields

- `trackBody()` stops sending `file_path`, `duration_ms`, `format`, `bitrate` and `sample_rate` on update. It keeps `title`, `artist_id`, `type_id`, `quality_ok`, `quality_notes` and `playlist_ids`.
- The comment at `track-form.ts:77-81` is updated: the update body carries metadata only; the analysis fields come from the file and are changed by replace, transcode or import.
- The generated `TrackBody` no longer has `file_path` and `duration_ms` after `api:sync`. Any code still referencing them fails to compile, which is intended.

### 3. Replace file action

- In the File block, a "Replace file" button. Disabled while the form is dirty, with the same hint as the reviewed mark.
- Opens `ReplaceFileDialogComponent` (new, in `src/app/features/library/`), modelled on `artist-dialog.component.ts`:
  - one `app-text-input` for the path under the media root, with a hint (same wording as the backend rule: relative, forward slashes);
  - a short note that the reviewed mark is cleared and the cue is reset if it no longer fits the new length;
  - Save calls `POST /api/tracks/{id}/replace-file` with `ApiSchema<'ReplaceFileBody'>` through `ApiClient`.
- On success the dialog closes with the new `Track`. The edit page reloads the track, the form resets to the stored values, and `cueResetNote` is shown when the cue was reset (compare the cue values before and after).
- On failure (codes as decided in the backend):
  - 422 with a field error on `file_path` (path invalid, not audio, or already taken by another track; the message names the other track) is set with `applySubmitError`;
  - 404 `track_file_not_found` (the file is missing on disk) is shown with `problemMessage()` as a form-level message, the dialog stays open;
  - 409 refusal (track in use: clock or one-time insert, planned hour, or on air/queued) is shown with `problemMessage()` and the `used_by` list, and the dialog stays open. The user closes the dialog; the same path cannot be retried for this track while it is in use.
- The replace is synchronous: the request may take as long as the analysis of the file. Show a busy state on Save and disable it until the response returns.
- The dialog does not offer a file picker in v1. The path is typed. A picker needs a list endpoint for the media folder, which is not part of this plan.

### 4. Texts and help

- `src/assets/i18n/en.json`: keys under `library.replaceFile.*` (button, dialog title, hint, the reviewed/cue note, success) and `forms.serverErrors` / `problems.*` for the new codes if they are not already present. No hard-coded strings.
- `src/assets/help/en/library.json`: an entry for the Replace file button, and for the read-only file path and length.

### 5. Types and generated client

- After the backend change: `make openapi` in the backend, then `npm run api:sync` here. Commit `api/openapi.json` with the frontend change, as CLAUDE.md requires.
- `ApiSchema<'ReplaceFileBody'>` and the 409 response of `replace-track-file` must be in the snapshot. If the backend does not list 409 for the endpoint, the UI cannot be written against it, so this is a blocking check.

## Tests to add

- `library.spec.ts`: the update request body contains no `file_path`, `duration_ms`, `format`, `bitrate` or `sample_rate`; the create request still contains `file_path`.
- New `replace-file-dialog.spec.ts`:
  - the button is disabled while the form is dirty;
  - success posts the path, closes with the track, and the edit page shows the new length;
  - a 422 `file_path` error appears on the control;
  - a 409 refusal shows the message and the `used_by` list, and the dialog stays open;
  - the reviewed-mark note and the cue-reset note are shown when the backend says so.
- Tests use `HttpTestingController`, `flushHelp()` and `settlePage()` from `core/testing`. No real HTTP.

## Verification

Before finishing: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. Report the actual results.

## Order of work

1. Backend change merged and `api/openapi.json` regenerated.
2. `npm run api:sync`, then the changes above in one branch.
3. Tests and the four checks.

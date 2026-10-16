# Phase F10 Plan — Import, Analysis, and Transcoding (radio-atlantida-frontend)

Status: Done
Based on: `docs/base.md` (Audio Quality Analysis, Audio Transcoding), `docs/tech-design.md` (§4, §6.2, §6.3, §6.4 v7-14, §6.5, §8.7, §11 item 27), `docs/frontend-init-plan.md` §8 item 10, backend `docs/phase-11-plan.md` (import, quality analysis, and transcoding, done)
Last updated: 2026-10-15

> Note (2026-10-16): the inbox section of the import page is replaced by the folder choice of `docs/f16-import-in-place-plan.md` (backend phase 18): files are imported where they lie, with no inbox and no library folder.

## 1. Goal

New audio files reach the library without typing metadata: the manager copies them into the inbox
folder on the station computer, sees them listed in the panel, chooses the type and playlists of
the batch, and starts the import. The backend analyses every file against the broadcast standard
from the settings. A track that falls short shows its issues and its measurements in the library,
and the manager fixes it with **Fix loudness** or **Optimize track**, choosing whether the fixed
file replaces the original or is written as an optimal copy next to it. The manager can analyse
tracks again, for example after changing the standard. The panel shows what the backend found and
offers the fixes the backend lists; it never decides quality itself.

The backend side is complete: `GET /api/import/inbox`, `POST /api/import`,
`POST /api/tracks/analyse`, `POST /api/tracks/transcode`, the track analysis fields
(`codec`, `channels`, `loudness_lufs`, `true_peak_dbtp`, `loudness_range_lu`, `source_bitrate`,
`quality_issues`, `fixes`, `analyzed_at`), the `quality` list filter, the operation kinds
`import`, `analyse`, `transcode` with their progress events, and the problem codes
`media_operation_running` and `media_tools_unavailable` are in `api/openapi.json`. The `import`
settings group (inbox and library folders, broadcast standard, thresholds) is already edited on the
settings page, which renders every group the backend sends (F5).

## 2. Decisions

1. **No upload** (design §8.7, §11 item 27). Files arrive through the inbox folder on the host; the
   panel lists the inbox and starts the import, nothing more.
2. **Import page** (`/import`, `features/import`, help `help.import`, a new help page ID and file),
   right after Library in the navigation (`nav.import`). Three parts:
   - **Inbox**: the folder (`dir`), its files (path, size, modification time in station time), a
     note when the folder holds more than listed (`more`), a Refresh button, and an empty state
     that says where to copy files. Non-audio files are listed as the backend lists them; the
     import skips them.
   - **Import form**: `type_id` (required, `app-playlist-type-select`) and `playlist_ids`
     (`app-playlist-picker`), the control names of `ImportBody`. The Import button is disabled
     while the form is invalid, an operation of this page runs, or the inbox is known to be empty.
     Per-field 422 errors land on the controls (`applySubmitError`); 409
     `media_operation_running` and 503 `media_tools_unavailable` are the form error.
   - **Analysis**: one button that analyses every track never analysed (`POST /api/tracks/analyse`
     with an empty body), with a note that re-checking existing tracks is done from the library.
3. **Operation status.** Each start runs through `OperationsService.runOperation()`. A small helper
   `followOperation()` (`core/operations/operation-run.ts`) remembers the started operation ID and
   reads its live state (progress, summary) from `OperationsService`; the presentational
   `app-operation-status` (`shared/ui`) shows a progress bar (determinate when `total` is known),
   the progress message or "{done} of {total}", and on completion the backend's summary
   (`result_summary`, for example the counts of imported, duplicate, unreadable, and skipped
   files). A failed operation is already an `error.alert` popup, so the line only says it failed.
4. **Reload on events.** The inbox reloads on `import.completed` and `import.failed` (also when
   the import was started elsewhere). The library list and an open track reload on
   `import.completed`, `analyse.completed`, and `transcode.completed`; a running analysis sends
   per-file progress, not a reload.
5. **After an import** the page links to the library filtered to tracks with issues
   (`/library?quality=issues`). The library reads its initial quality filter from the `quality`
   query parameter (router input binding), so the link opens the right list.
6. **Library selection and bulk actions.** The library table gets a checkbox column (select one
   row, or every loaded row from the header). While tracks are selected, an action bar
   (`app-track-media-actions`, presentational, in `features/library`) offers:
   - **Analyse** with `force` ("Decode again", off by default: unchanged files are only checked
     again against the current settings), for at most 1,000 tracks (`AnalyseBody`).
   - **Fix loudness** and **Optimize track**, each counting the selected tracks whose `fixes` list
     that fix; only those tracks are sent (`TranscodeBody.track_ids`, 1 to 200), and a button with
     a count of 0 is disabled. The panel does not decide what is fixable; it reads `fixes`.
   - **Output** (`output`): `copy` (default: an optimal copy next to the original, the original
     stays on disk) or `replace` (the original is deleted). Starting a fix with `replace` asks
     first (`ConfirmService.confirm`); the request is sent after the dialog closes, because the
     page needs its operation ID, and a refusal is shown as the bar's error.
   - A note when a selected track has `low_bitrate` (no transcode can fix it: replace the source
     file) or `file_missing`.
   - The status line of decision 3. On completion the selection is cleared and the list reloads.
   Selection is kept by track ID across "Load more" and cleared when the filters change.
7. **Track edit page.** The File section shows the analysis: codec, channels, loudness (LUFS),
   true peak (dBTP), loudness range (LU), the source bitrate of a transcoded file, and when it was
   analysed (station time), or "Not analysed". The issues are listed with a short explanation each
   (`library.quality.explain.<code>`). The same `app-track-media-actions` acts on this one track.
   Media actions are disabled while the form has unsaved changes ("Save or undo your changes
   first"), because a transcode changes `file_path` and the length, and saving a stale form would
   write the old path back. On completion the track is read again and the form reset from it.
8. **Quality override.** The track form gains `quality_ok` (a checkbox, design §6.2) for a stored
   track: it overrides the analysis result until the next analysis. Its hint says so. On create it
   is not sent, as before.
9. **Help and translations.** New `assets/help/en/import.json` (fields `type_id`, `playlist_ids`);
   `library.json` gets the import in its steps and the fields `quality_ok`, `force`, `output`.
   Translations in `en.json`: `nav.import`, `import.*`, `library.analysis.*`, `library.media.*`,
   `library.quality.explain.*`, `operationStatus.*`.

## 3. Tasks

1. **`core/operations`**: `followOperation()` (started ID, live state, running flag), with tests.
2. **`shared/ui`**: `app-operation-status` (progress bar, message, summary, failed), with tests.
3. **Import page**: inbox list with Refresh and empty state, import form, analyse-new button,
   status lines, reload on `import.*`, link to the library with issues.
4. **Library list**: checkbox column and selection, `app-track-media-actions` bar, analyse and
   transcode requests, replace confirmation, reload on media events, `quality` query parameter.
5. **Track edit**: analysis facts and explained issues, media actions for the track (disabled while
   dirty), reload after completion, `quality_ok` override.
6. **Routes and navigation**: `import` with `nav.import`, after Library; help page ID
   `help.import` with its file and the help file check.
7. **Help and translations** (decision 9).
8. **Tests** next to the code: the helper (ID, progress, terminal); the status line; import page
   (inbox list and empty state, body with type and playlists, 409 as form error, field error on
   the control, progress then summary, inbox reload on `import.completed`, analyse-new body);
   library (selection, fix counts from `fixes`, transcode body with only fixable IDs and the
   output, replace asks first, analyse body with `force`, reload and cleared selection on
   completion, quality from the query parameter); track edit (facts, actions disabled while
   dirty, reload after a transcode, `quality_ok` in the body).

## 4. Out of scope

Uploading files through the browser; editing the tags of inbox files before the import; per-file
results of an import beyond the backend's summary (the backend reports counts only); deleting an
original left next to an optimal copy (the manager's job on disk, backend phase 11 §5);
re-checking the whole library in one click (the analysis endpoint takes explicit IDs for tracks
already analysed); the logs page (F11).

## 5. Done when

The manager can see the inbox, import it with a type and playlists and follow the progress to the
summary, find the tracks with issues in the library, read a track's measurements and issues, fix
loudness or optimize one or several tracks into a copy or in place, analyse tracks again, and
override the quality flag. `npm run lint`, `npm run format:check`, `npm test`, and
`npm run build` pass.

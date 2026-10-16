# F20 Plan — Track Cue Editor and Usage Marks (radio-atlantida-frontend)

Status: Implemented (2026-10-16; backend contract: backend `docs/phase-22-plan.md`)
Based on: `docs/base.md`, backend `docs/phase-22-plan.md`, `docs/tech-design.md` (§6, §7, §8.4, §8.5), `docs/f10-import-plan.md`, `docs/f15-air-window-plan.md`, `docs/f18-library-pagination-sort-plan.md`, `docs/f19-track-titles-review-weekdays-plan.md`
Last updated: 2026-10-16

## 1. Goal

Two requests from the operator:

1. **Cut the edges of a track** (applause at the end, noise or talk at the start) without touching the file. The operator sets a start and a stop point (cue in, cue out) on a waveform drawn as in audio editors (positive and negative amplitude around a centre line), hears the result, and saves. On air the track starts at cue in and ends at cue out with a short fade.
2. **See which tracks are in use** in the library: in the track plan, on air or queued, in playlists.

## 2. Decisions (2026-10-16)

1. **Cue points, not trimming.** The file is never changed. Liquidsoap plays the cut through the `liq_cue_in` / `liq_cue_out` annotations, which the backend already uses for truncated items (`liq_cue_out`, `liq_fade_out`, tech-design §8.4). A destructive trim is out of scope.
2. **Fades at the cue points**, with defaults of 1 s in and 2 s out (backend settings, §4.1). A track stores its own fade lengths; 0 means a hard cut.
3. **Changing the cue of a planned track is allowed.** It is refused only while the track is queued in Liquidsoap or on air (409 `track_on_air`). Otherwise the backend saves it and rebuilds the future hours that contain the track, because its on-air length changed; `queued`, `aired`, and `missed` items are not touched (tech-design §7, "Rebuild after a change"). The page follows the rebuild with `followOperation()`.
4. **Own waveform component**, no third-party library (no wavesurfer.js): Canvas 2D, pointer events, keyboard, `role="slider"` handles.
5. **Peaks come from the backend** (ffmpeg on the first request, cached), not from decoding the file in the browser: small, cached, and the same for every viewer.
6. **Usage marks** (operator's choice): "In plan" (next planned start), "On air / queued", and the number of playlists, with filters.
7. **Cue editing is reviewing** (operator, 2026-10-16): a cue change does not clear the reviewed mark, and saving the cue marks the track reviewed unless the operator unticks it (§5.2).
8. **Show, never recompute.** The on-air length of a track (`cue_out − cue_in`) and the usage state come from the backend; the panel shows them.

## 3. Current code (2026-10-16)

- `PlayerService` (`core/player`) plays a preview through an audio element: `play`, `toggle`, `pause`, `resume`, `stop`, `seek(seconds)`, `position`, `duration` signals. The audio is `GET /api/tracks/{id}/audio`.
- The track edit page (`track-edit.component.ts`) has the form, the quality section (`track-quality.component.ts`), analysis, and the Reviewed toggle (F19).
- The library columns: select, play, title, artist, type, duration, format, quality, reviewed, actions; list state in `library-list-state.ts` (F18).
- `Track.playlist_ids` is already in the API, so the playlist count needs no backend change; the "no playlist" filter does.

## 4. Backend contract (backend `docs/phase-22-plan.md`)

The panel cannot start parts 5.2–5.5 before this is in `api/openapi.json`. Summary of what the panel uses:

### 4.1 Cue points

- `Track` gains `cue_in_ms`, `cue_out_ms` (absent = end of file), `fade_in_ms`, `fade_out_ms` (0–5000), and the read-only `air_duration_ms` (the on-air length the planner fits; `duration_ms` stays the file length).
- `PUT /api/tracks/{id}/cue` (`set-track-cue`) with the four fields, all required → `{ track, build_operation_id? }`. Refusals: 409 `track_on_air` (queued or on air), 409 `track_not_analysed`; 422 per field with `cue_order`, `cue_beyond_end`, `air_too_short` (under 5 s), `fades_too_long`. `PUT /api/tracks/{id}` keeps the cue untouched.
- A rebuild runs only when cue in or out changed and the track has planned items; a fade change needs none (fades are read at push time).
- Settings `liquidsoap.cue_fade_in_ms` (1000) and `liquidsoap.cue_fade_out_ms` (2000): the defaults the editor proposes; the backend never applies them by itself.
- A cue change does **not** clear the reviewed mark.
- A new file (transcode, replaced on disk) keeps a cue that still fits; otherwise the cue is reset and the analysis or transcode result lists the track under `cue_reset`.

### 4.2 Waveform

- `GET /api/tracks/{id}/waveform` (`get-track-waveform`): `{ duration_ms, bucket_ms, peaks, max_peak }`, `peaks` a flat list `[min0, max0, min1, max1, ...]` in −127..127 (linear, 127 is 0 dBFS), mono, 50 ms buckets (12 KB for 5 minutes); `max_peak` the largest absolute value, 0 to 127 (0 for silence). Computed on the first request (up to about 2 s) and cached by file checksum, with an `ETag`. 409 `waveform_unavailable` when the file is missing or unreadable, 503 `media_tools_unavailable` without ffmpeg.

### 4.3 Usage

- `Track` gains `next_planned_at` (earliest planned or queued item) and `playout_state` (`on_air`, `queued`, or absent).
- `GET /api/tracks` takes `in_plan=true|false` and `in_playlist=true|false`, and the sort key `next_planned_at`.

### 4.4 In points in plan and history

- Plan items may now start after 0 in the file. Every `planned_out_ms` gets a `planned_in_ms` beside it (track plan, missed items, played tracks, air window), and now playing gets `in_ms` beside `out_ms`. The length is `out − in`; `planned_out_ms` alone is no longer a length.

## 5. Work

### 5.1 Waveform component (`shared/waveform`)

`app-waveform-editor`, presentational (no HTTP), OnPush, signals.

- **Inputs:** `peaks`, `maxPeak`, `durationMs`, `cueIn`, `cueOut`, `fadeIn`, `fadeOut`, `position` (playback cursor, ms), `disabled`.
- **Outputs:** `cueChange` (`{ cueIn, cueOut }`), `fadeChange`, `seek` (ms), `playRequest` (`'in' | 'beforeOut' | 'cursor'`).
- **Drawing (Canvas 2D):** a centre line; for every bucket a vertical bar from min to max, so the shape is mirrored around zero as in audio editors; redrawn at the device pixel ratio and on resize (`ResizeObserver`). Regions before cue in and after cue out are dimmed. Fades are drawn as a sloped envelope over the waveform. Colours come from CSS custom properties, so the light and dark themes work.
- **Level scale (decided 2026-10-16):** the peaks are drawn enlarged by `127 / max_peak`, so a quiet master (a compressed file after a loudness fix peaks well below full scale) fills the height like a loud one; `max_peak = 0` (silence) is drawn as it is. The toolbar shows the factor ("×2.6", tooltip with the peak level) and a "Real level" toggle (`aria-pressed`) that draws the factor 1. Horizontal level lines, mirrored below the centre, are placed by the real level, dBFS = 20 × log10(|v| / 127): the top edge (the peak level when enlarged, else 0 dB), then 0, −6, −12, −20 dB where they fit, and −∞ at the centre; in the linear scale they are uneven (−6 dB at half the height), and a line too close to its neighbour or the centre for a label is left out. The labels are an axis of their own left of the waveform (a second canvas, `drawDbAxis`), with a tick and a label for every line above and below the centre; the waveform keeps only the lines.
- **Zoom and scroll:** wheel with Ctrl or the "+" / "−" buttons zoom around the pointer; wheel or a scrollbar scrolls; "Fit" shows the whole track. When zoomed, the peaks of the visible range are drawn from the same data (zooming past 1 bucket per pixel shows wider bars).
- **Pointer:** dragging a handle moves cue in or out (snap to the cursor within 5 px); a click elsewhere moves the playback cursor (`seek`); a time ruler shows mm:ss at a step that fits the zoom.
- **Keyboard (each handle is `role="slider"` with `aria-valuetext` "1:02.340"):**
  - ← / → move 100 ms, Shift 1 s, Alt 10 ms; Home / End go to the file edge;
  - on the waveform: Space play / pause, I sets cue in at the cursor, O sets cue out at the cursor, "+" / "−" zoom, 0 fits.
  - A visible focus ring on each handle; the shortcut list is in the help panel and in a tooltip.
- **Limits** are only shown, not decided: the handles cannot cross and keep the minimum length from the backend's validation message; the backend's 422 is the authority.

### 5.2 Cue section on the track page

A section "Start and stop" on `track-edit.component.ts`, loaded with `@defer` (the canvas code is not needed for the first view):

- loads the waveform with `rxResource`; shows a progress bar while the first request computes the peaks; on `waveform_unavailable` shows "The file cannot be read"; for a track without `duration_ms` the section shows "Analyse the track first" with the existing Analyse action (the cue needs the file length);
- fields synced with the handles: Start, Stop (mm:ss.SSS, new `app-duration-input` in `shared/forms` if the time input does not fit), Fade in, Fade out (ms, quick choices 0 / 1 / 2 / 3 s);
- when a point leaves the file edge and its fade is 0, the fade takes the default from settings (`liquidsoap.cue_fade_in_ms`, `liquidsoap.cue_fade_out_ms`);
- "On air: 3:41.560 (file 4:05.300)";
- buttons: "Play from start point", "Play last 5 s before stop", "Reset" (whole file, no fades), "Save";
- a reactive form of its own (validators mirroring §4.1), part of the page's `PendingChanges`; Save sends `PUT /api/tracks/{id}/cue`; `applySubmitError()` maps field errors; `track_on_air` is shown as "The track is on air or queued; try again after it has played", the form stays dirty;
- a checkbox "Mark as reviewed", checked by default: after the cue save succeeds the page sends `POST /api/tracks/review` for the track (as the F19 rename dialog); unticked, the mark stays as it was;
- after a save with `build_operation_id`, `followOperation()` and `app-operation-status` show the rebuild of the plan.

### 5.3 Preview honours the cue

- `PreviewTrack` gains optional `cueInMs`, `cueOutMs`, `fadeInMs`, `fadeOutMs`. `PlayerService` starts at cue in and stops at cue out; the library play button passes the track's cue, so the operator hears what goes on air.
- Fades in preview through a Web Audio `GainNode` on the audio element (`createMediaElementSource`), injected through a token and faked in tests as the live media APIs are (`fake-live.testing.ts`).
- The editor's buttons play the unsaved points (they pass the form values, not the saved ones). Previews never go to air.

### 5.4 Usage marks in the library

- **Column "In plan":** the next planned start (`stationTime`), empty when none; sortable (`next_planned_at`).
- **On air / queued:** an icon in the title cell (`aria-label` "On air" / "Queued"), from `playout_state`.
- **Column "Playlists":** the count of `playlist_ids`, with the names in the tooltip (`CatalogService`).
- **Filters:** "In plan: All / Yes / No" (`in_plan`) and "Without playlist" (`in_playlist=false`), in the URL (`library-list-state.ts`), resetting to page 1 and clearing the selection as F18.
- The library reloads the current page on the playout and plan events the air window listens to (F15), debounced, so the marks follow the air without polling.
- **Duration column** shows `air_duration_ms`; when the track is cut, a cut icon and the file length in the tooltip ("3:41 on air, file 4:05"). The sort key stays the file length (`duration`).
- On the track page the same marks are shown next to the title; the cue Save button is disabled with a hint while `playout_state` is set (the backend still decides).

### 5.5 Lengths with an in point

- One pure helper `plannedLengthMs(in, out)` next to the `duration` pipe; the track plan hour (`track-plan-hour.component.ts`), the on-air card and its list (`on-air.component.ts`), missed items, and played tracks show `out − in` instead of `planned_out_ms`; the on-air elapsed / total uses `out_ms − in_ms`.
- Analysis and transcode summaries (F10) list `cue_reset` tracks with "The start and stop points were reset: the new file is shorter".

## 6. Files

| File | Change |
|------|--------|
| `api/openapi.json` | `npm run api:sync` after backend phase 22 |
| `src/app/shared/waveform/waveform-editor.component.ts` | new: canvas, handles, zoom, keyboard |
| `src/app/shared/waveform/waveform-draw.ts` | new: pure drawing and pixel ↔ ms mapping (tested without a canvas) |
| `src/app/shared/forms/duration-input.component.ts` | new if needed: mm:ss.SSS input |
| `src/app/core/catalog/*` | waveform read for the track page, `TrackQuery` filters from the spec |
| `src/app/core/player/player.service.ts` | cue and fades in preview, gain node token |
| `src/app/features/library/track-cue.component.ts` | new: cue section (smart part: load, form, save) |
| `src/app/features/library/track-edit.component.ts` | cue section (`@defer`), usage marks |
| `src/app/features/library/library-page.component.ts` | In plan and Playlists columns, on-air icon, filters, debounced reload |
| `src/app/features/library/library-list-state.ts` | `in_plan`, `in_playlist` |
| `src/app/features/settings/*` | the two fade defaults in the Liquidsoap group (labels, hints, validators) |
| `src/app/features/track-plan/*`, `features/live/on-air.component.ts`, `features/missed-items/*`, `features/played-tracks/*` | lengths as `out − in` (5.5) |
| `src/app/features/library/track-media*.ts` | `cue_reset` in analysis and transcode summaries |
| `src/assets/i18n/en.json` | `library.cue.*`, `library.usage.*`, `library.filters.inPlan.*`, `settings.liquidsoap.cue_fade_*`, `errors.track_on_air`, `errors.track_not_analysed`, `errors.waveform_unavailable`, `errors.cue_order`, `errors.cue_beyond_end`, `errors.air_too_short`, `errors.fades_too_long`, `library.media.cueReset` |
| `src/assets/help/en/library.json` | sections "Start and stop points", "Keyboard in the waveform", "Which tracks are in use" |
| `docs/tech-design.md` | sync with the backend copy |
| `CLAUDE.md` | F20 in the phase list and the required-reading list |

## 7. Tests

- **Drawing helpers:** ms ↔ px at several zoom levels; visible bucket range; ruler step choice.
- **Waveform component:** drag of a handle emits `cueChange`; handles cannot cross; arrow keys with and without Shift / Alt; I and O at the cursor; Space emits `playRequest`; `aria-valuetext` follows the value; disabled blocks input. Canvas calls checked on a fake 2D context.
- **Cue section (HttpTestingController):** waveform load and `waveform_unavailable`; Save with "Mark as reviewed" sends the review request after the cue `PUT`, unticked sends none, a failed `PUT` sends none; fields and handles stay in sync; default fades applied from settings; Save sends the four fields; 422 on `cue_out_ms`; 409 `track_on_air` keeps the form dirty; `build_operation_id` is followed; unsaved-changes guard.
- **Player:** starts at cue in, stops at cue out, gain ramps on the fake gain node.
- **Library:** In plan column and sort; on-air icon; playlist count tooltip; filters in the URL and the request; debounced reload on playout events.
- **Lengths:** the track plan, on-air, missed, and played pages show `out − in` for an item with an in point.
- Help content test passes with the new sections.

## 8. Order of work

1. 5.1 waveform component on fixture peaks (no backend dependency).
2. Backend phase 22 (§4), `make openapi`; `npm run api:sync`.
3. 5.5 (lengths) together with the sync, so no page shows a wrong length; then 5.2 and 5.3, then 5.4.
4. Release backend and frontend of the same version (F12).

## 9. Done when

- The operator opens a live recording, drags the stop point to the last chord, hears the last 5 seconds with a 2 s fade, and saves; on air the track ends there without the applause, and the plan uses the shorter length.
- A track on air refuses the save with a clear message; a track planned for tomorrow saves and the plan is rebuilt.
- Everything in the editor works from the keyboard.
- The library shows which tracks are planned, on air or queued, and in how many playlists; "Without playlist" finds unused tracks.
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 10. Out of scope

- Cutting or rewriting audio files.
- Automatic detection of applause; automatic cue suggestions from silence (possible later from ffmpeg `silencedetect`).
- Cue points in bulk; a stereo waveform; spectral views.
- Changing the cue of items already queued in Liquidsoap.

# F19 Plan — Track Titles, Reviewed Mark, "All" Weekdays (radio-atlantida-frontend)

Status: Implemented
Based on: `docs/base.md`, `docs/tech-design.md` (§6, §8.1), `docs/f10-import-plan.md` (selection bar), `docs/f16-import-in-place-plan.md`, `docs/f17-bulk-delete-plan.md`, `docs/f18-library-pagination-sort-plan.md`, backend `docs/phase-21-plan.md`
Last updated: 2026-10-16

## 1. Goal

Three requests from the operator:

1. **Clean titles on air.** Imported files often have broken titles. The operator fixes them quickly, one at a time from the library table or in bulk with find-and-replace, and the corrected title and artist are what listeners see (backend phase 21 sends them to Liquidsoap; today the file tags go on air).
2. **"Reviewed" mark.** After a bulk import the operator checks tracks (title, quality, bitrate, loudness) and marks them reviewed, so the library shows which tracks still need a look. Any change of a track's content (title, artist, file, Fix loudness / Optimize) clears the mark; the backend decides this, the panel only shows it.
3. **"All" in weekdays.** Every weekday checkbox group gets an "All" checkbox that selects or clears the seven days.

## 2. Decisions (2026-10-16)

1. **Contract first.** Parts 4.1 and 4.2 start after backend phase 21: `make openapi` there, `npm run api:sync` here, `api/openapi.json` committed with this phase. Types: `ApiSchema<'Track'>['reviewed_at']`, the bodies and results of `POST /api/tracks/review` and `POST /api/tracks/rename`, `TrackQuery['reviewed']`, the sort enum with `reviewed`. Part 4.3 has no API change and can be done first.
2. **Show, never recompute.** The panel does not decide when the mark is cleared and does not compute renamed titles: after a save, rename, transcode, or analysis it reloads and shows the backend's `reviewed_at`; the bulk rename preview is the backend's `dry_run` answer.
3. **Inline rename** (operator's answer to Q1): a "Rename" icon button on each library row.
4. **Bulk rename** (Q4): literal find-and-replace on the selected tracks, preview first, then apply.
5. **Stream metadata** (Q3): title and artist go separately; Icecast shows "Artist - Title", a jingle without an artist shows its title alone. Nothing to build in the panel; the help text says so.

## 3. Current code (2026-10-16)

- The title is already editable on the track edit page (`track-form.ts`, `track-edit.component.ts`) and sent by `PUT /api/tracks/{id}`, which replaces the whole track.
- The library has a selection bar (Analyse, Fix loudness, Optimize, Delete), selection kept across pages (F18), and URL state in `library-list-state.ts`.
- `app-weekdays-input` (`shared/forms`) is used by the grid page and the play-rule edit page; its value is a sorted list `1..7`.

## 4. Work

### 4.1 Titles

1. **Validators** (`track-form.ts`, shared with the dialogs below): required, max 500, no control characters (`noControlCharacters` in `shared/forms/validators.ts`); the value is trimmed and whitespace runs collapsed on send, as the backend does. Server code `invalid_characters` is translated (`errors.invalid_characters`) and put on the `title` control by `applyServerErrors()`.
2. **Edit page:** hint under the title (help `library`, field `title`): "Listeners see this title and the artist. A change applies to tracks queued after saving. Changing the title, artist, or file clears the reviewed mark."
3. **Inline rename dialog** (`track-rename-dialog.component.ts`, `MatDialog`, focus trapped, `app-text-input` with the title validators):
   - opened by a row icon button (`aria-label` "Rename {title}");
   - Save: `GET /api/tracks/{id}`, then `PUT` with the same fields and the new title (`PUT` replaces the track, so the dialog never sends a partial body); `applySubmitError()` on failure, field errors on the title control;
   - a checkbox "Mark as reviewed" (unchecked by default): after the `PUT` succeeds it sends `POST /api/tracks/review` for that track, because the rename itself clears the mark;
   - on close with a change: the library `reload()`s the current page (F18 decision 6).
4. **Bulk rename dialog** (`track-bulk-rename-dialog.component.ts`), "Rename (N)" in the selection bar, up to 1,000 tracks:
   - fields: Find (1–200), Replace with (0–200), "Match case" checkbox;
   - "Preview" sends `POST /api/tracks/rename` with `dry_run: true`; the dialog lists the changed tracks (old → new title), the count of unchanged ones, and the refused ones with their reason (`title_empty`, `title_too_long`, `track_not_found`, translated);
   - any edit of the fields invalidates the preview; "Apply" is enabled only for a current preview with at least one change and sends the same body with `dry_run: false`;
   - the result shown is the apply answer (it may differ from the preview if a title changed meanwhile); a note says the renamed tracks lost their reviewed mark;
   - after apply: `reload()`; `track_not_found` IDs leave the selection, the others stay selected.

### 4.2 Reviewed mark

1. **Library column "Reviewed"** after Quality: a check icon with the date (`stationTime`) in its tooltip and `aria-label`, or an empty cell; sortable with the `reviewed` key (F18 `mat-sort-header`, `library.sort.by`).
2. **Filter** next to the quality filter: All / Reviewed / Not reviewed → `reviewed=true|false`; in the URL as `reviewed` (`library-list-state.ts`, unknown values fall back to All); a change goes to page 1 and clears the selection (F18 decision 4/7).
3. **Selection bar:** "Mark reviewed (N)" and "Mark not reviewed (N)": one `POST /api/tracks/review` with the selected IDs of every page (1,000 limit as F17), then `reload()`; `not_found` IDs leave the selection with a short message; the others stay selected.
4. **Edit page:** a "Reviewed" toggle in the quality section with the date. It sends the review request at once (not part of Save, so it never makes the page "unsaved"). While the form has unsaved changes the toggle is disabled with the hint "Save the changes first": saving a title, artist, or file change clears the mark on the backend, so a mark set before the save would be lost.
5. **After transcode or analysis events** the library already reloads (F10/F18), so a cleared mark shows without extra code.
6. **Import page (F16):** after an import finishes, a link "Review the new tracks" opens `/library?reviewed=false`.

### 4.3 "All" weekdays

1. `app-weekdays-input` gets a first checkbox "All" (`forms.weekdays.all`) before Monday, inside the same `fieldset`:
   - checked when all 7 days are selected, `indeterminate` when 1–6 are, unchecked when none;
   - clicking it when not all are selected sets `[1, 2, 3, 4, 5, 6, 7]`; when all are selected it clears to `[]`;
   - marks the control dirty and touched as a day click does; disabled with the control;
   - follows outside value changes (the grid's cell buttons) through the existing `controlVersion`.
2. The grid and play-rule pages need no change.

## 5. Files

| File | Change |
|------|--------|
| `api/openapi.json` | `npm run api:sync` after backend phase 21 |
| `src/app/core/catalog/*` | `TrackQuery` picks up `reviewed` and the sort key from the spec (no hand-written types) |
| `src/app/shared/forms/weekdays-input.component.ts` | "All" checkbox |
| `src/app/shared/forms/validators.ts` | `noControlCharacters` |
| `src/app/features/library/track-form.ts` | title validators, cleaning on send |
| `src/app/features/library/track-edit.component.ts` | title hint, "Reviewed" toggle |
| `src/app/features/library/track-rename-dialog.component.ts` | new: inline rename |
| `src/app/features/library/track-bulk-rename-dialog.component.ts` | new: bulk find-and-replace with preview |
| `src/app/features/library/track-review.ts` | new: bulk review request and result handling (as `track-bulk-delete.ts`) |
| `src/app/features/library/library-page.component.ts` | Reviewed column and sort, filter, row rename button, selection bar actions |
| `src/app/features/library/library-list-state.ts` | `reviewed` query parameter |
| `src/app/features/import/*` | "Review the new tracks" link |
| `src/assets/i18n/en.json` | `forms.weekdays.all`, `library.fields.reviewed`, `library.filters.reviewed.*`, `library.selection.markReviewed`, `library.selection.markUnreviewed`, `library.selection.rename`, `library.rename.*`, `library.bulkRename.*`, `errors.invalid_characters`, `errors.title_empty`, `errors.title_too_long` |
| `src/assets/help/en/library.json` | sections "Reviewing imported tracks", "Renaming tracks"; title field hint |
| `docs/tech-design.md` | sync with the backend copy (§6, §8.1) |
| `CLAUDE.md` | F19 in the phase list and the required-reading list |

## 6. Tests

- **Weekdays (`form-inputs.spec.ts`):** none → All → `[1..7]`; All again → `[]`; two days → indeterminate; checking the seventh day checks All; setting the value from outside updates All; a disabled control disables All.
- **Validators:** `noControlCharacters` (newline, tab, `\u0000`; Cyrillic and emoji pass).
- **Rename dialog (HttpTestingController):** `GET` then `PUT` with every field unchanged except the title; field error on the title from a 422; with "Mark as reviewed" a review request follows the `PUT`, without it none; the library reloads the same page.
- **Bulk rename dialog:** Preview sends `dry_run: true` with the selected IDs; editing Find disables Apply until a new preview; Apply sends `dry_run: false` and shows the apply answer; refused reasons translated; `track_not_found` leaves the selection.
- **Library:** Reviewed column with the station-time tooltip; filter sends `reviewed=false`, goes to page 1, writes the URL; opening `/library?reviewed=true` sends it; sort by `reviewed`; "Mark reviewed (N)" sends one request with IDs from two pages and reloads the current page.
- **Edit page:** the toggle sends the review request and leaves the form pristine; it is disabled while the form is dirty.
- Help content test passes with the new sections.

## 7. Order of work

1. 4.3 "All" weekdays (no backend dependency).
2. Backend phase 21 (titles on air, reviewed mark, bulk rename), `make openapi`.
3. `npm run api:sync`, then 4.1 and 4.2.
4. Release backend and frontend of the same version (F12: `api/openapi.json` equals the backend release).

## 8. Done when

- In the grid and play-rule forms, one click on "All" selects the seven days, another clears them.
- From the library the operator renames a track in a dialog without opening its page; the new title is heard on air for items queued after the save.
- The operator removes `[www.site.com]` from 200 selected titles: the preview shows the new titles, Apply writes them.
- After importing 200 files, the filter "Not reviewed" shows 200; the operator checks and marks them, in bulk or one by one, until the filter is empty; renaming or optimizing a reviewed track brings it back into "Not reviewed".
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 9. Out of scope

- Regular expressions in the bulk rename; renaming artists in bulk.
- Editing the tags of the audio files.
- Who reviewed, review notes, review history.
- Rewriting titles of items already queued in Liquidsoap.

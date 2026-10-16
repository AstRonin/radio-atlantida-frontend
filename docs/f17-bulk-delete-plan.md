# F17 Plan — Bulk Track Delete (radio-atlantida-frontend)

Status: Done
Based on: `docs/tech-design.md` (§6), `docs/f10-import-plan.md` (library selection and bulk actions), backend `docs/phase-19-plan.md`
Last updated: 2026-10-16

## 1. Goal

The library already lets the manager select tracks (one row, or every loaded row from the header) and run Analyse, Fix loudness, and Optimize track on them. This phase adds **Delete** for the selection. It uses the backend's `POST /api/tracks/delete` (phase 19): one request for up to 1,000 tracks, answered with the deleted IDs and a refusal per track that could not be deleted. The panel never sends one `DELETE` per track.

## 2. Decisions (2026-10-16)

1. **Contract first.** The work starts after backend phase 19: `make openapi` there, `npm run api:sync` here, and `api/openapi.json` is committed with this phase. Types come from `ApiSchema<'DeleteTracksBody'>` and `ApiSchema<'DeleteTracksResult'>`.
2. **Button.** "Delete (N)" in the selection bar, next to "Clear selection" in the heading row of `selection-heading`, `matButton` with the error colour. It is not part of `app-track-media-actions`: that component is about files and operations; delete is a library action.
   - Disabled while the delete request runs, while a media operation of the page runs (`media.run.running()`), and when more than 1,000 tracks are selected. Over the limit a hint says "Select at most 1,000 tracks to delete" (`library.bulkDelete.tooMany`).
3. **Confirm first.** `ConfirmService.confirm()` with `library.bulkDelete.confirmTitle` and `library.bulkDelete.confirmMessage` ("Delete N tracks from the library? The files stay on disk. Tracks that have played, are planned, or are in a filler pool are kept."). The request is sent after the dialog closes with yes. Not `confirmDelete()`: that one runs a single action and shows a single `used_by` refusal.
4. **One request, synchronous.** `api.post('/api/tracks/delete', { body: { track_ids } })` with the IDs of the selection in its order. While it runs the bar shows an indeterminate progress bar and "Deleting N tracks…" (`library.bulkDelete.running`). It is cancelled when the page is left (as every page request); the backend still finishes the delete (backend decision 6), and the list shows the result on the next visit.
5. **Result.** After the response:
   - the list reloads (`reload()`), and the deleted IDs are removed from the selection;
   - the refused tracks **stay selected**, so the manager sees which ones are left;
   - a status line: "Deleted 4 of 6 tracks." (`library.bulkDelete.done`), `role="status"`;
   - when `refused` is not empty, a list under it (`role="alert"` on the heading only): the track title (or `#id` for `track_not_found`), the reason translated by `code` with the existing `errors.track_in_use`, `errors.track_has_history`, `errors.track_not_found`, and for `track_in_use` the clock names of `used_by` as links to the clock edit page. At most 20 items are shown, then "and N more" (`library.bulkDelete.moreRefused`); all of them remain selected.
   - The result is cleared when the selection or the filters change, or another action starts.
6. **Errors.** A failed request (422, 500, network) is shown in the bar with `errorMessage()` (`core/api`), as `media.error()` is; the selection is kept. A 500 detail says how many were deleted before the error; the list is reloaded in that case too, because some tracks may be gone.
7. **Single-row Delete stays** as it is (`confirmDelete` with `DELETE /api/tracks/{id}`).
8. **State lives in a small helper** `TrackBulkDelete` in `features/library/track-bulk-delete.ts` (like `track-media.ts`): signals `running`, `result`, `error`, and `start(tracks)`, with teardown through `DestroyRef`. The page wires it; a presentational `app-track-delete-result` (`features/library/track-delete-result.component.ts`) renders the status line and the refusal list from inputs.

## 3. Files

| File | Change |
|------|--------|
| `api/openapi.json` | `npm run api:sync` after backend phase 19 |
| `src/app/features/library/track-bulk-delete.ts` | new: request, state, result |
| `src/app/features/library/track-delete-result.component.ts` | new: status line and refusal list (presentational) |
| `src/app/features/library/library-page.component.ts` | Delete button, confirm, wiring, keep refused tracks selected |
| `src/assets/i18n/en.json` | `library.bulkDelete.*` |
| `src/assets/help/en/library.json` | a section on deleting selected tracks and why some are kept |
| `src/app/core/help/help-content.spec.ts` | if it lists help keys |
| `docs/tech-design.md` | sync with the backend copy (§6 endpoint row) |
| `CLAUDE.md` | F17 in the phase list and the required-reading list |

## 4. Tests

- **`track-bulk-delete` (HttpTestingController):** sends `track_ids` in selection order; `running` true until the response; result with deleted and refused; an `ApiProblem` sets `error`; leaving (destroy) cancels the request.
- **Library page:** button hidden without a selection; disabled with 1,001 selected (hint shown) and while a media operation runs; cancel in the confirm dialog sends nothing; yes sends one `POST /api/tracks/delete` and no `DELETE`; after a mixed result the list reloads, the deleted tracks leave the selection, the refused stay, the status line and the refusal list show translated reasons and the `used_by` clock link; a 500 keeps the selection and reloads.
- **`track-delete-result`:** caps the list at 20 with "and N more"; `track_not_found` shows `#id`.
- Help content test passes with the new section.

## 5. Done when

- Selecting 6 tracks, of which 2 have played, and confirming Delete sends one request; 4 tracks disappear from the list, 2 stay selected with "The track has play history and cannot be deleted."
- Selecting every loaded track after "Load more" up to 1,000 and deleting them sends one request; the button is disabled above 1,000.
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 6. Out of scope

- Selecting every track matching the filter beyond the loaded pages.
- Deleting files from disk.
- Undo.

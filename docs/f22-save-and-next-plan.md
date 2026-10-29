# F22 Plan — Save and Next in the Track Editor (radio-atlantida-frontend)

Status: Implemented (2026-10-29, frontend only; no backend change)
Based on: `docs/base.md`, `docs/tech-design.md`, `docs/f18-library-pagination-sort-plan.md`, `docs/f20-track-cue-editor-plan.md`
Last updated: 2026-10-29

## 1. Goal

The operator edits tracks like on air: one track after another, without going back to the list between them. A **Save and Next** button saves the open track and opens the next track of the list the operator is working through, in the same editor.

## 2. Decisions (2026-10-29)

1. **Frontend only.** The save uses the existing track update request and its error handling, unchanged. The backend is not involved in choosing the next track.
2. **"Next" follows the list as the operator sees it**: the current sort, order, search, playlist and type filters, and pagination. If the next track is on the next page, that page is read with the same filters and order.
3. **The list context is kept in memory**, not in the URL. `LibraryCursorService` (root service, `features/library/library-cursor.ts`) holds the query, offset, size, total and the row IDs in order of the last successful list read. The library page writes it after each read. The editor reads it to find the next ID.
4. **Last track of the list**: no navigation. The form stays on the saved track, which is re-read, and shows "Saved. There is no next track in this list."
5. **No list context** (page reload, or a track opened by URL without a list in this session): the form stays open with the same message. There is no fallback to a guessed order.
6. **Save error**: no navigation. The same error display as **Save** is used. A failed next-page read keeps the current track open and shows its error.
7. **Navigation** is `router.navigate(['/library', id])` on the same editor component, so the route guard still asks before leaving with unsaved cue edits.
8. **Not shown on "New track"**, because there is no list position.

Known limit: a stored cursor from an earlier list visit is used if the track is still in it. If the list was changed elsewhere since then, the order may be stale. Surviving a page reload would need the list context in the editor URL, together with the search and playlist/type filters. This is not done.

## 3. Changed files

- `src/app/features/library/library-cursor.ts` (new): the cursor service.
- `src/app/features/library/library-page.component.ts`: writes the cursor after each list read.
- `src/app/features/library/track-edit.component.ts`: the **Save and Next** button; `save()` and `saveAndNext()` share one private submit path with the unchanged request, play-rules and error logic; helpers `openNext`, `openTrack`, `stayOnSaved`; the `noNextTrack` status line.
- `src/app/features/library/library.spec.ts`: a list test (the cursor keeps rows in order) and four editor tests (next track; last track stays with the note; next page is read with the same filters and order; save failure stays on the track with the error).
- `src/assets/i18n/en.json`: `library.edit.saveAndNext`, `library.edit.noNextTrack`.
- `src/assets/help/en/library.json`: a help entry for Save and Next.

## 4. Layout of the cue section

The **Start and stop** section (`app-track-cue`) is separated from the form above it by a 1 px top border (`var(--mat-sys-outline-variant)`) and 1.5 rem of space above and of padding above the border. The rule is in the `styles` block of `track-edit.component.ts`. The same divider is used by other sections of the app.

## 5. Verification

- Typecheck, lint, Prettier on the changed files, the production build, and the unit tests (506 of 506, including the 5 new ones) pass.
- The UI was not checked in a running browser against a backend. Behaviour is covered by the unit tests only.

## 6. Open points

1. Show the button on "New track" as well? Currently no.
2. Persist the list context across page reloads (editor URL carries the list state)? Currently in memory only.
3. Update the Russian help text when the operator-facing copy is confirmed.

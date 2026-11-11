# Artists page paging, sort, and delete guard: frontend plan

Depends on `backend/docs/artists-paging-plan.md`. The backend adds `sort` (`name`, `track_count`), `order`, `offset`, `limit` (1 to 500, default 100) to `GET /api/artists`, and `total` to its response. `GET /api/artists/{id}` already exists. The two changes are released together.

## Goal

1. The Artists page is paged and sortable by name and by track count, like the Library page (`docs/f18-library-pagination-sort-plan.md`).
2. An artist with tracks cannot be deleted. The Delete button is disabled up front with a tooltip, and the track count links to the artist's tracks in Library.
3. The artist picker no longer loads every artist. It searches on the server, at most 50 results.
4. Library can be opened filtered by artist (`?artist_id=<id>`) and has an artist filter.

## Steps

1. Sync the snapshot: `npm run api:sync` after the backend change is regenerated. Check that `ArtistList` has `total` and the list operation has `sort`, `order`, `offset`, `limit`.

2. Artists page (`src/app/features/artists/artists-page.component.ts`):
   - Add `mat-paginator` (`[length]="total()"`, page sizes `[25, 50, 100, 200]`, default 50, `showFirstLastButtons`, `providePaginatorIntl()`) and `MatSort` on the Name and Tracks columns (server-side sort: `name`, `track_count`; default `name` asc).
   - Keep the debounced server-side search. A new search goes back to the first page.
   - Keep page, size, sort, and order in the URL (`page`, `size`, `sort`, `order`, `replaceUrl`, merged query params), as Library does in `library-list-state.ts`. If the Library helpers can be made generic without changing Library's behaviour, reuse them; otherwise write a small `artists-list-state.ts` with the same shape. Say which in the report.
   - Requests go through one `Subject` + `switchMap` (or the existing `rxResource` with the page request as its params), so a slow old page never overwrites a newer one.
   - After a delete or rename, reload the current page. If it comes back empty and it is not the first page, go to the new last page (same as Library).
   - A hidden live region announces the page status (reuse the Library pattern and add `artists.pageStatus`).

3. Tracks column: when `track_count > 0`, the number is a link (`routerLink="/library"`, `queryParams: { artist_id }`) with an accessible label such as "Show the N tracks of {name}". `0` stays plain text.

4. Delete button:
   - Disabled when `track_count > 0`.
   - Tooltip on the disabled button: "The artist has N tracks. Move them to another artist or delete them first." A disabled button gets no pointer or focus events, so wrap it in a `span` that carries `matTooltip` and `tabindex="0"` only while disabled, and give the button `aria-disabled`/a description so screen readers hear the reason. There is no such wrapper in the project yet; keep it local to this page.
   - Enabled when `track_count === 0`. The confirm dialog and its refusal view stay as they are: they still handle `artist_has_history` (no tracks, but play history) and a track added since the page loaded (`artist_in_use` with `used_by`).

5. Library (`src/app/features/library/library-page.component.ts`, `library-list-state.ts`):
   - Add an `artist_id` query param input, read once in `ngOnInit` like `quality` and `reviewed`.
   - Add an artist filter control to the filter form, using `app-artist-select` (after step 6). Map it to `artist_id` in the `TrackQuery` mapping, count it in the active filter count, and clear it with the other filters.
   - Changing the artist filter goes back to the first page, like the other filters.

6. Artist picker (`src/app/shared/pickers/artist-select.component.ts`, `src/app/core/catalog/catalog.service.ts`):
   - Today it loads the full list once and filters on the client, and it finds the selected id in that list (`displayName`, the start-value effect, `onInput`, `select`). With a limit, this would lose the name of a selected artist not in the first page and clear the control while typing.
   - New behaviour: the typed text is debounced (300 ms) and sent as `GET /api/artists?q=<text>&limit=50&sort=name`. The options are the returned items; when `total > 50`, show a last non-selectable row "Type to narrow down (N more)".
   - The selected artist is kept as `{ id, name }` in the component. For a start value or a reset with an id, load the name with `GET /api/artists/{id}` (add `CatalogService.artist(id)`). A 404 shows the id as unknown and keeps the value; do not clear it silently.
   - Do not clear the control because the typed text is not in the current options. Keep the existing rule for clearing (text no longer equal to the selected name), but compare with the kept selected name, not with the loaded list.
   - Find every other caller of `CatalogService.artists()` and list them in the report. If any of them needs the full list, stop and report before changing it.

7. i18n: new keys under `artists.*` (delete tooltip, track link label, page status, picker "more" row) and `library.filters.artist`. Add them to every locale file that exists. No hard-coded strings.

8. Help: `src/assets/help/en/artists.json` (or the file the Artists page uses): paging and sort, why Delete is disabled, the link to the tracks. Library help: the artist filter.

9. Tests:
   - Artists page: paginator and sort send the right `offset`, `limit`, `sort`, `order`; a new search resets to page 0; URL state is read and written; an empty last page after delete moves back one page.
   - Delete is disabled with the tooltip when `track_count > 0`, enabled when 0; the 409 `artist_has_history` refusal is still shown.
   - The track count link goes to `/library?artist_id=<id>`; 0 is not a link.
   - Library: `?artist_id=5` sends `artist_id=5` in the track request and shows the artist in the filter; clearing filters removes it.
   - Picker: typing sends `q` with `limit=50`; a start value whose artist is not in the results shows its name (from `GET /api/artists/{id}`); typing text that matches no option does not clear the selected value until the text differs from the selected name; the "more" row appears when `total > 50`.

10. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Report exit codes. `format:check` may fail on files outside this change; list them and do not fix them.

## As implemented (differences from the steps above)

- Step 2: the list state is a separate `artists-list-state.ts`. The Library helpers are tied to `TrackSort` and used across Library and its specs, so making them generic was not worth the risk. The Artists search text is not kept in the URL.
- Step 4: the disabled Delete uses Material's `disabledInteractive` with `[disabled]="track_count > 0"` instead of a `span` wrapper. The button stays focusable and hoverable, gets `aria-disabled="true"`, and the tooltip (`artists.deleteBlocked`) is its accessible description. Because a click still reaches the handler, `remove()` returns early when `track_count > 0`.
- Step 6: the picker loads nothing until the field is first focused, then reads `limit=50&sort=name`. A 404 on the selected id keeps the value and shows `artists.unknown` ("Unknown artist #{id}"). A failed search is not retried by focusing again with the same text; typing different text reads again. `CatalogService.artists(query)` returns the whole `ArtistList`; its only caller is `ArtistSelectComponent`, and none of its hosts needs the full list.
- Step 7: extra keys `artists.unknown` and `artists.sortBy`. `en.json` is the only locale file.
- Step 8: the Artists page uses `help.library`, so its help is in `src/assets/help/en/library.json`; there is no `artists.json`.

## Constraints

- Generated types only (`ApiSchema<...>`). Do not hand-write request or response types.
- No commit, push, branch, or change of git state. Do not edit files outside this change.
- Do not change the confirm dialog, the used-by list, or Library's existing list state behaviour.

## Done when

- The Artists page pages and sorts on the server, with the state in the URL.
- Delete is disabled and explained for artists with tracks, and the count links to their tracks in Library.
- Library filters by artist from the URL and from the filter form.
- The picker searches on the server with at most 50 results and keeps the selected artist's name.
- All checks above pass, with exit codes reported.

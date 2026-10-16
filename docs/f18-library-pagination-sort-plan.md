# F18 Plan — Library Pages and Sort (radio-atlantida-frontend)

Status: Done
Based on: `docs/tech-design.md` (§6), `docs/frontend-init-plan.md` (F5 library), `docs/f10-import-plan.md` (selection), `docs/f17-bulk-delete-plan.md`, backend `docs/phase-20-plan.md`
Last updated: 2026-10-16

## 1. Goal

The library can hold thousands of tracks. Today the page reads them a hundred at a time in title order and offers only "Load more": the manager cannot jump to a page, does not see how many tracks match, and cannot sort by a column.

This phase replaces "Load more" with a paginator (page numbers, page size, "1 – 50 of 3,412") and makes the column headers sortable. **The sort is done by the backend** (phase 20: `sort`, `order`, `offset`, `total` on `GET /api/tracks`): the page never sorts rows in the browser, because the browser holds only one page and a local sort would order that page alone.

## 2. Decisions (2026-10-16)

1. **Contract first.** The work starts after backend phase 20: `make openapi` there, `npm run api:sync` here, and `api/openapi.json` is committed with this phase. The query type stays `TrackQuery` (`core/catalog`), now with `sort`, `order`, and `offset`; `ApiSchema<'TrackPage'>` has `total`. The sort keys are the spec's enum (`NonNullable<TrackQuery['sort']>`), never a hand-written union.
2. **Paginator.** `mat-paginator` under the table, with `providePaginatorIntl()` (as on the import page) and `showFirstLastButtons`. Page sizes 25, 50, 100, 200; default 50 (`LIBRARY_PAGE_SIZES`, `LIBRARY_DEFAULT_PAGE_SIZE`). `length` is `total` from the response. A page is read with `offset = pageIndex * pageSize` and `limit = pageSize`. The "Load more" button and the cursor go away from this page.
3. **Sortable headers.** `matSort` on the table and `mat-sort-header` on Title, Artist, Type, Duration, Format, and Quality (column → `sort`: `title`, `artist`, `type`, `duration`, `format`, `quality`). Select, play, and actions are not sortable. `matSortDisableClear`: there is always a sort; the default is Title ascending and its arrow is shown. `matSortStart="asc"`. Each header gets `sortActionDescription` from `library.sort.by` ("Sort by {column}"); `aria-sort` on the `th` comes from Material.
4. **Every change reads from the backend.**
   - Sort change → `offset` 0 (page 1), same page size.
   - Filter change (search, playlist, type, quality) → page 1, the sort is kept.
   - Page size change → the page that contains the first row of the current page (the paginator's own `pageIndex`).
   - Page change → that page.

   All of them go through the one `pages` stream with `switchMap`, so a slow answer to an older request is dropped (as today). The search keeps its 300 ms debounce; sort and page clicks are not debounced.
5. **State in the URL.** `page` (1-based), `size`, `sort`, `order` are query parameters of `/library` next to the existing `quality`, written with `router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true })`. Coming back from a track's edit page, or reloading the browser, opens the same page in the same order. Values not allowed (an unknown sort, a size not in the list, page < 1) fall back to the defaults; defaults are left out of the URL. The search text and the playlist and type filters are not put in the URL in this phase.
6. **Reload keeps the place.** Import, analysis, and transcode events, a single delete, a bulk delete (F17), and "Retry" reload the **current** page with the current sort. When the answer is empty, `offset > 0`, and `total > 0` (the last page was emptied), the page moves to the last page (`ceil(total / size) - 1`) and reads it once more.
7. **Selection across pages.** The selection is a map by track ID and no longer a subset of the loaded rows:
   - changing the page or the sort keeps it; a filter change clears it (as today);
   - the header checkbox selects or clears the **current page**; its checked and indeterminate state looks at the current page only;
   - "N selected" counts every page; "Clear selection" clears all;
   - a reload refreshes the selected tracks that are on the read page (new fixes, title) and keeps the others as they were; tracks deleted (F17 `deleted`) leave the selection explicitly, not by being absent from the page.

   This changes F17: "Select every loaded track after Load more" becomes "select tracks on several pages"; the 1,000 limit of F17 stays. If F17 is merged first, its test that relies on "Load more" is rewritten here.
8. **Loading.** The indeterminate progress bar stays above the table; while a page loads the paginator and the sort headers stay enabled (a newer click wins through `switchMap`), and the old rows stay visible until the new ones arrive, so the table does not jump.
9. **Accessibility.** The paginator's labels are translated (`paginator.*`, already present). After a page or sort change the focus stays on the control that was used. A visually hidden `role="status"` line announces "Page {page} of {pages}, {total} tracks" (`library.pageStatus`) after each load.
10. **Other track lists do not change.** `track-picker`, `playlist-tracks`, and `playlist-edit` keep the cursor in the default order (backend decision 7). `CatalogService.tracks()` is unchanged.

## 3. Files

| File | Change |
|------|--------|
| `api/openapi.json` | `npm run api:sync` after backend phase 20 |
| `src/app/features/library/library-page.component.ts` | `MatSortModule`, `MatPaginatorModule`, `providePaginatorIntl()`; `offset`/`sort`/`order` in the page request; URL state; selection across pages; reload keeps the page; remove "Load more" and the cursor |
| `src/app/features/library/library-list-state.ts` | new: reads and writes `page`, `size`, `sort`, `order` from and to query parameters, with the fallbacks (pure functions, tested alone) |
| `src/app/features/library/library.routes.ts` | if the route needs `paramsInheritanceStrategy` or input binding for the new query parameters |
| `src/assets/i18n/en.json` | `library.sort.by`, `library.pageStatus` |
| `src/assets/help/en/library.json` | a section on sorting and pages; selection is kept across pages |
| `src/app/features/library/library.spec.ts` | tests below; replace the "Load more" tests |
| `docs/f17-bulk-delete-plan.md` | if not yet built: "after Load more" → "across pages" (decision 7) |
| `docs/tech-design.md` | sync with the backend copy (§6 track list) |
| `CLAUDE.md` | F18 in the phase list and the required-reading list |

## 4. Tests

- **`library-list-state`:** parses valid parameters; unknown `sort`, `order=up`, `size=37`, `page=0`, and `page=abc` fall back to the defaults; defaults are not written.
- **Library page (HttpTestingController):**
  - first load sends `sort=title&order=asc&offset=0&limit=50` and no `cursor`; the paginator shows `total`;
  - clicking the Duration header sends `sort=duration&order=asc&offset=0`; clicking again sends `order=desc`; the arrow and `aria-sort` follow; the rows are shown in the order the backend returned them (the test returns them unsorted on purpose and checks they are **not** re-sorted);
  - next page sends `offset=50`; page size 100 sends `limit=100` and the page containing the first row; a filter change goes back to `offset=0` and keeps the sort;
  - opening `/library?page=3&size=25&sort=artist&order=desc` sends `offset=50&limit=25&sort=artist&order=desc`; changing the page updates the URL with `replaceUrl`;
  - an `analyse.completed` event reloads the same offset and sort; an empty last page after a reload with `total > 0` moves to the last page;
  - selection: select two on page 1, go to page 2, select one: "3 selected"; the header checkbox on page 2 selects only page 2; a filter change clears all; a reload updates a selected track on the page and keeps the ones on other pages;
  - a load error shows the message and "Retry" reads the same page.
- `npm run typecheck` shows no use of `next_cursor` left in the library page.
- Help content test passes with the new section.

## 5. Done when

- With 3,000+ tracks, the library opens on page 1 of Title ascending with "1 – 50 of N"; the last page is one click away and loads without reading the pages before it.
- Sorting by Duration descending shows the longest tracks of the **whole** library (and of the current filter) on page 1, tracks without a duration last.
- Opening a track from page 7 sorted by Artist and going back returns to page 7 sorted by Artist.
- Selecting tracks on two pages and running Analyse (F10) or Delete (F17) acts on all of them.
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 6. Out of scope

- Sorting by several columns, or by fields the table does not show.
- Search text and playlist/type filters in the URL.
- Paginators and sort on other pages (playlists, play history, logs).
- "Select every track matching the filter" beyond the pages the manager visited.
- Virtual scrolling.

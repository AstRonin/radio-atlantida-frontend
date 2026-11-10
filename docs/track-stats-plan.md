# Plan — Library Statistics Row and Clear Filters (radio-atlantida-frontend)

Status: Approved by the operator (2026-11-10); not started
Based on: `docs/tech-design.md` (§6), backend `docs/track-stats-plan.md`
Last updated: 2026-11-10

## 1. Goal

The Library page shows a compact row with the number of tracks, how many are reviewed, with issues, and not analysed, and the total on-air time. The figures follow the active filters. A **Clear filters** button returns to the figures of the whole library in one click.

## 2. Decisions

1. **Backend first.** `GET /api/tracks/stats` comes from `backend/docs/track-stats-plan.md`. Bring it here with `npm run api:sync`. No other backend change is expected; if the work needs one, stop and report.
2. **The row stays on the Library page, as its own presentational component.** It takes data through inputs and makes no HTTP call, so it can move to a dashboard later without a rewrite.
3. **Figures follow the filters.** With empty filters they describe the whole library.
4. **Clickable figures apply a filter.** Reviewed, With issues, and Not analysed set the matching filter. Tracks and On-air time are plain text.
5. **The row never blocks the table.** While loading it keeps the previous values. If the request fails, it shows dashes and the table works as usual, with no popup of its own.
6. **The row quality badge is unchanged.** It still reads `quality_ok`.
7. **Sort by duration needs no frontend change.** The backend now sorts the key `duration` by the on-air length, which is what the column shows.

## 3. Work

### 3.1 Component (`features/library/library-stats.component.ts`)

- `app-library-stats`, OnPush. Inputs: `stats` (`ApiSchema<'TrackStats'> | null`). Output: the filter chosen by a click.
- Markup: a `<dl>` in a wrapping flex row. Clickable values are real `<button type="button">` elements with an accessible name including the label and the value. Not `aria-live`: figures change often, and the page already has a status announcement.
- Labels: **Tracks**, **Reviewed**, **With issues**, **Not analysed**, **On-air time**.
- On-air time: pass whole minutes to the existing `formatInterval` (`shared/forms/interval-input.component.ts`), which gives `72 h` or `1 h 30 min`. Round `air_duration_ms` to the nearest minute. Do not add a new duration format.
- Numbers use the panel's locale formatting if one exists; otherwise plain digits.

### 3.2 Page (`features/library/library-page.component.ts`)

- Place the row between `app-page-header` and the filter form (between lines 137 and 139).
- Load through `ApiClient` with `GET /api/tracks/stats`, in its own stream (`Subject` and `switchMap`), passing `filterQuery` only, with no `sort`, `order`, `offset`, or `limit`. A new request cancels the previous one.
- Refresh on: a filter change, the realtime events that reload the list (lines 803–831), and local mutations that reload it. Do **not** refresh on a page or sort change: `reload()` covers those too, so the stats refresh needs its own trigger rather than following every `reload()`.
- A click on a figure sets the matching control: **Reviewed** → `reviewed` to the "reviewed" option; **With issues** → `quality` to `issues`; **Not analysed** → `quality` to `unanalysed`. The existing `valueChanges` flow does the rest (page 0, selection cleared, URL updated).

### 3.3 Clear filters

- A `matButton` **Clear filters** at the end of `form.list-filters`, after the "without playlist" checkbox, visible only when at least one filter is active. A search of only spaces does not count as active.
- Follow `shared/pickers/track-filters.component.ts:135-139`: an `active` computed using `controlVersion`, and `@if (active() > 0)`.
- Clearing resets all seven controls with one `reset()`, so one request goes out rather than one per control. `q` becomes empty, and `without_playlist` false. Page returns to 0, the selection is cleared by the existing flow, and `quality`, `reviewed`, `in_plan`, and `in_playlist` leave the URL. Page size and sort stay.
- After the click, focus moves to the search field, since the button disappears.

### 3.4 Texts

- Add keys under `library.stats.*` and `library.filters.clear` in `src/assets/i18n/en.json`, the only language file.
- Update `src/assets/help/en/library.json`: what the row shows, that it follows the filters, that **On-air time** counts the part between the track's start and stop points, and that **With issues** matches the quality filter, so it can include a track whose badge was set to OK by hand.

## 4. Tests

In `features/library/library.spec.ts` and `library-usage.spec.ts`. `http.verify()` runs after each test, so the existing helpers must flush the new stats request.

- The row shows the figures from the response; `air_duration_ms` is shown as hours and minutes; zero is shown as zero, not a dash.
- First load requests stats with no filter params.
- A filter change requests stats with the same params as `/api/tracks`, and none of `sort`, `order`, `offset`, `limit`.
- A page change and a sort change do not request stats.
- A realtime event that reloads the list requests stats again.
- A failed request shows dashes, the table still renders, and no error replaces the table.
- A new request cancels the one in flight.
- A click on each clickable figure sets the right filter and goes to page 0.
- Clear filters: hidden with no active filter, hidden for a spaces-only search, visible for each filter.
- Clear filters: all controls are empty, one list request and one stats request go out, the filter params leave the URL, page size and sort stay, and focus moves to search.

## 5. Done when

- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.
- `api/openapi.json` is synced from the backend and committed with this change.
- In the running panel: with no filters the row shows the whole library; a filter changes the figures and matches the paginator total; **Clear filters** brings back the whole-library figures; **With issues** gives the same number as the list it opens.

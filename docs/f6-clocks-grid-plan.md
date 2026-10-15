# Phase F6 Plan — Clocks and Grid (radio-atlantida-frontend)

Status: Done
Based on: `docs/base.md` (clock rules, grid), `docs/tech-design.md` (§4, §6.0, §6.2, §6.5, §7, §7.2, §10.2), `docs/frontend-init-plan.md` §8 item 6, backend `docs/phase-7-plan.md` (clock and grid rules, done) and `docs/phase-8-plan.md` (clock build operation)
Last updated: 2026-10-15

## 1. Goal

The manager builds 60-minute clock templates in the panel and assigns them to hours of the grid,
up to 30 days ahead. Saving a clock shows the backend's dry check (segments, shortfall, warnings,
replaced fixed elements) and, when a segment is short, opens the blocking filler dialog built in F4.
Every rule is checked by the backend; the panel sends the template and shows the result (CLAUDE.md,
"Show, never recompute").

The backend side is complete: every endpoint below is in `api/openapi.json`, including
`save-with-filler` (frontend plan §9.6 item 3 is satisfied).

## 2. Decisions

1. **Durations are edited in milliseconds**, like the settings of F5 and the help field texts, so
   control names and values match `ClockElementBody` and backend field errors land unchanged. Each
   duration field shows its `m:ss` reading next to it.
2. **Empty tolerances are left out** of the request, so the backend applies
   `rotation.default_duration_tolerance_ms` and `rotation.default_fixed_tolerance_ms`. An empty
   tolerance field says that the default from the settings applies.
3. **Element order is edited with move up / move down buttons** (accessible without a pointer).
   Order is the request array order; the backend derives `position` from it.
4. **Elements keep their `id`** in a hidden control. A new element has none. A new fixed element
   that overlaps an existing one replaces it on the backend; the result names it (§7.2).
5. **The layout shown is the backend's** `clock.layout` of the last load or save. While the form has
   unsaved changes, the layout is marked as "as saved" and is not recomputed.
6. **After a save the editor stays open** with the saved clock (the URL becomes `/clocks/{id}` after
   a create), so the manager can read the check. The list is reached with Back.
7. **Clock build operation.** `build_operation_id` of a save, a filler choice, or a grid change is
   passed to `OperationsService.waitFor()`, so it appears in the header menu; the page shows a short
   line when it completes. A failure is already an `error.alert` popup.
8. **Grid view is one week** of station local dates, starting on a chosen date (default: today in
   the station zone), read with `GET /api/grid?from=&to=`. Hours without a clock are empty cells.
9. **Grid changes use one form** for assign and clear (`weekdays`, `hours`, `valid_from`,
   `valid_to`, and the clock for assign). The + button of a cell in the week view adds its weekday
   and hour to the form (the first pick also sets `valid_from`); the weekday and hour inputs remove
   them, since the backend takes every weekday × every hour. `valid_from` is limited to today .. today + `rotation.grid_horizon_days`
   (default 30) in the date input; the backend checks again.
10. **`nonEmptyValidator`** (a list with at least one entry) lives in `shared/forms/validators.ts`,
    because both features need it and features never import each other.
11. **Station local dates** (`YYYY-MM-DD`) are computed with `Intl` in the station zone
    (`core/time/local-date.ts`), never with the browser zone.

## 3. Tasks

1. **Shared lists.** `CatalogService.clocks()`; `app-clock-select` in `shared/pickers` (single
   select, shows an "incomplete" badge); `app-hours-input` in `shared/forms` (24 checkboxes, value
   is a sorted list of 0..23).
2. **Station dates.** `core/time/local-date.ts`: `stationToday(zone)`, `addDays(date, n)`,
   `weekdayOf(date)` (1 = Monday). Pure functions with tests.
3. **Clocks list** (`features/clocks`, route `/clocks`): name, status badge, element count,
   updated time (`stationTime`), edit and delete. Delete uses `ConfirmService`; the refusal shows
   `used_by` (`clock_in_use`, `clock_has_history`).
4. **Clock editor** (`/clocks/new`, `/clocks/:id`):
   - name, default filler mode (`modes="default"`) with its playlist or artist source;
   - elements as a `FormArray` named `elements`, with controls named as `ClockElementBody`:
     `id`, `placement`, `fixed_minute`, `fixed_tolerance_ms` (both only for `fixed`),
     `nominal_duration_ms`, `duration_tolerance_ms`, `playlist_ids` (multi-select of all types),
     `filler_mode`, `filler_source_id` (only for `playlist` and `artist`);
   - add, remove, move up, move down;
   - validators mirroring the DTO (ranges 0..59, 0..600000, 1..3600000, at least one playlist and
     one element, name 1..200);
   - save: `POST /api/clocks` or `PUT /api/clocks/{id}`; field errors such as
     `elements[2].fixed_minute` land on the element's control (`applySubmitError`);
   - the result: shortfall, warnings translated by `code` (with element and segment numbers, and
     the blocked weekday hours), replaced elements;
   - `requires_filler_choice` opens `FillerDialogService` with the short segments; its actions call
     `save-with-filler` and `save-incomplete`, and the editor shows the clock they return;
   - `PendingChanges`, `warnBeforeUnload`, `unsavedChangesGuard`.
5. **Layout view** (`clock-layout.component.ts`, presentational): a 60-minute bar of the segments
   (content, shortfall, overflow) with fixed elements at their start, plus a list of segments for
   screen readers: time range, elements, holder's filler mode, shortfall.
6. **Filler pool** section on the editor of a saved clock: `GET /api/clocks/{id}/filler-pool`
   shows used tracks as history (`used_at` in station time) and edits the unused ones with the
   ordered track picker; saved with `PUT /api/clocks/{id}/filler-pool`.
7. **Grid page** (`features/grid`, route `/grid`): week view (hours × dates, clock name, incomplete
   badge, today marked), previous / next week and a start date; the assign / clear form; the result
   of a change (created slots, replaced slots with `trimmed` / `split` / `deleted`); the slot list
   (`GET /api/grid/slots?from=<today>`) with delete through `ConfirmService`. After a change the
   week and the slots are reloaded and the build operation is awaited.
8. **Routes and navigation**: `clocks` and `grid` registered with `nav.clocks` and `nav.grid`,
   placed after Separation rules.
9. **Translations** in `en.json` (`nav`, `clocks`, `grid`). Help files `clocks.json` and `grid.json`
   exist; field hints are checked against the control names.
10. **Tests** next to the code: local dates, hours input, clock select; clocks list (delete
    refusal); editor (body sent, element field error on the right control, short save → dialog →
    `save-with-filler`, replaced element shown, build operation awaited, pool save); grid (week
    request range, cell toggles the form, assign body and replaced result, slot delete).

## 4. Out of scope

Track plan, filler reminders, and warnings of built hours (rotation views, later phase); the
missed-item reschedule target picker (outages phase).

## 5. Done when

The manager can create a clock with fixed and flow elements, see its segments and warnings, choose
a filler in the dialog or save it incomplete, edit its pool, assign it to grid hours for a date
range, see what was replaced, and delete a slot. `npm run lint`, `npm run format:check`, `npm test`,
and `npm run build` pass.

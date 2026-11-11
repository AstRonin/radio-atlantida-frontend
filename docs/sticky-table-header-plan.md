# Sticky table headers: frontend plan

## Goal

Every table in the panel scrolls its rows inside the table, and the header row stays visible at the top of the table. A table that fits in its height looks and behaves as today: no inner scrollbar. A longer table gets a height limit and a vertical scrollbar of its own; the header stays fixed while the rows scroll under it.

## Current state

- The page scrolls inside `mat-sidenav-content`. The toolbar, the outage banner, and the player bar are outside that scroller.
- Every table is wrapped in `<div class="table-scroll">` (`src/styles.scss:93-99`: `overflow-x: auto`; `.table-scroll .mat-mdc-table { min-width: 40rem }`). The wrapper is already a scroll container, so a sticky header inside it sticks to the wrapper's top edge. It only needs a height limit.
- No shared table component. Two kinds of tables:
  - Material `mat-table` (7): playlists, clocks, library, artists, import, playlist-types, play-rules pages.
  - Raw `<table>` with `<thead>` (9): `track-plan-hour`, logs, missed-items, `on-air` (live), played-tracks, `outage-list`, grid (`slots`), `grid-week`, `shared/air-window/air-window-list`. Their `th` cells have no background.

## Design

- `.table-scroll` becomes `overflow: auto` (both axes) with `max-height: var(--table-max-height)`. Horizontal scrolling stays inside the wrapper, as today.
- Default `--table-max-height`: the viewport height minus the shell (toolbar, player bar) and a page header with a filter row, for example `calc(100dvh - 16rem)`, with a floor (`max(…, 20rem)`) so it is usable on a low window. Measure the real values in the running app and pick the number so that on a 1080p screen the table box, the page header, and the paginator (library, artists) are all visible without scrolling the page.
- A page may override `--table-max-height` on its wrapper when the default does not fit (pages with two tables: played-tracks with the outage list, grid with the week view; the track plan with one table per hour, where the hour tables are short and usually below the limit).
- The paginator stays outside the wrapper, so it is always visible under the table.

## Steps

1. Global styles (`src/styles.scss`):
   - `.table-scroll { overflow: auto; max-height: var(--table-max-height); }` and the default variable on `:root`. Keep the `min-width` rule.
   - Shared rule for raw tables: `.table-scroll > table > thead th { position: sticky; top: 0; z-index: 2; background: var(--table-header-background, var(--mat-sys-surface)); }`. Use the surface colour the table actually sits on (tables inside cards may need `--mat-sys-surface-container*` through the variable).
   - Header bottom border: with `border-collapse: collapse`, a sticky `th` loses its border while scrolling. Draw it with `box-shadow: inset 0 -1px 0 <border colour>` (or `border-collapse: separate; border-spacing: 0`). Check every raw table.

2. Material tables (7 pages): `*matHeaderRowDef="columns; sticky: true"`. Check that the header background is opaque and that header cells (`mat-sort-header`, the library select-all checkbox) stay above body cells with checkboxes, buttons, and `app-play-button`.

3. Raw tables (9 components): rely on the global rule. Fix local `th` CSS that overrides background or position. In `grid-week` only `thead th` is sticky; the `tbody th` row headers are not.

4. Per page: check the height in the running app and set a local `--table-max-height` where needed (step "Design"). Keyboard: the wrapper is now a scroll region, so give it `tabindex="0"` and an accessible name (`role="region"` with `aria-label` from the page title or an i18n key) only where the table has no focusable cells; tables with buttons or links in every row are scrolled by focus already.

5. Tests: no unit test for the sticky behaviour itself. Check by hand in `npm run dev` on each page with enough rows (library, logs, played-tracks, track plan, grid, air window, import): a short table has no inner scrollbar; a long one scrolls inside with the header fixed; horizontal scroll still works on a narrow window; light and dark themes; wide and narrow layouts.

6. `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.

## Report

- The default `--table-max-height` chosen and why, and each page that overrides it.
- The header background used and any local overrides.
- Any table where sticky does not work, with the reason.

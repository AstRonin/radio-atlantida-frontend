# Import file details: frontend plan

## Goal

The Import page file table shows the artist, title, and duration of each file, and a row can be expanded to see the technical facts. Data comes from the backend plan `import-file-details-plan.md` (backend `docs/`): `ImportFile.track` for known files, `ImportFile.name_title` / `name_artist` for new files, and `GET /api/import/file-info?path=` when a new file's row is expanded. No loudness.

## Prerequisite

The backend change is merged into the backend working tree; run `npm run api:sync` and commit `api/openapi.json` with this change.

## Current state

- `src/app/features/import/import-page.component.ts`: `mat-table` over `pageFiles()` (client-side paging and sorting, `docs/import-sort-plan.md`), columns File, Size, Modified, Status; status badge or a link to `/library/:id`.
- Tests: `src/app/features/import/import.spec.ts`.

## Design

### Columns

File, Artist, Title, Duration, Size, Modified, Status (all sortable).

- Known file (`track` set): artist, title, and duration (`air_duration_ms`, through the existing duration/`plannedLength` formatting used by the library) from `track`.
- New file before expanding: `name_artist` / `name_title` in a muted style with a tooltip "From the file name; tags take priority at import". Duration empty.
- New file after expanding (probe loaded): the effective `artist` / `title` and `duration_ms` from `file-info`; the muted style stays only where the source is `file_name`.
- `not_audio`: empty cells.
- If the import form has an artist chosen, the Artist cell of new files shows it (the form wins at import) — use the form control's value, no request.

### Expanded row

- A toggle button (icon, `aria-label`, `aria-expanded`) in each row except `not_audio`; detail row with `multiTemplateDataRows` and `matRowDef ... when`.
- Known file: format, codec, bitrate, sample rate, channels, quality issues (same labels as the library), reviewed mark, link to the track. For `original` a note that the facts describe the library copy.
- New file: on first expand call `file-info` (through `ApiClient`), show a progress indicator, then format, codec, bitrate, sample rate, channels, tags, the effective title and artist with their source, and the issues `file-info` reports.
  - Artist and title from tags: when `artist_source` (or `title_source`) is `tag`, show the tag value with a note that it replaces the value from the file name at import, and show the file-name value next to it when it differs ("From tags; replaces «X» from the file name"). When the source is `file_name`, say there is no tag and the file name is used. The Artist / Title cells of the row switch to the tag values at the same time. A failure shows `problemMessage()` in the row with a Retry button; no popup.
- Several rows may be open. Results are cached in the component (a signal map keyed by `path` + `size` + `modified_at`), so collapsing and expanding again does not repeat the request; cache cleared when the folder changes or the listing reloads with a different size/modified for a path. Requests are cancelled when the page is left.

### Sorting

- Add Artist, Title, Duration to the existing comparators. Artist and Title use the same natural collator as File; Duration numeric. The value sorted is what the cell shows (track, probe result, or file-name guess).
- Empty values (no artist, no duration yet) sort last in both directions; ties fall back to File ascending, as today.
- Expanding a row and getting its probe result may move it when sorted by Duration/Artist/Title; accept this (it only happens on a user action).

### Layout

The table gets wider; it already lives in `.table-scroll` with horizontal scroll. Keep File first; let Title and File truncate with an ellipsis and a tooltip with the full text if the table gets too wide.

## Steps

1. `npm run api:sync`, then fix compile errors.
2. Component: new columns, cell values (one `computed` view model per row combining listing + cache + form artist), expand toggle and detail row, `file-info` loading with cache and cancellation.
3. Sorting: extend the comparators and the column type.
4. i18n keys in `src/assets/i18n/en.json` for column titles, the tooltip, detail labels, source labels (tag / file name), the `original` note, errors, Retry, and the toggle `aria-label`.
5. Help: update the import help JSON (`src/assets/help/<lang>/`) with a sentence about the new columns and expanding a row.
6. Tests (`import.spec.ts`): known file shows track values; new file shows the file-name guess muted; expand calls `file-info` once and shows the result, collapse + expand does not call again; error and Retry; form artist overrides the new file's artist; `not_audio` has no toggle; sorting by Artist / Title / Duration with empty values last.
7. `npm run lint`, `npm run format:check`, `npm test`, `npm run build`; check by hand in `npm run dev` on a folder with new and imported files.

## Report

- Files changed, how the row view model and cache are built, test and command results, anything that differed from this plan.

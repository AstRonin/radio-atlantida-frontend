# Import file table sort: frontend plan

## Goal

The file table on the Import page (`/import`) can be sorted by every column: File, Size, Modified, Status. The page opens sorted by File, ascending. Sorting happens in the browser; the backend does not change.

## Current state

- Page and table are one component: `src/app/features/import/import-page.component.ts` (inline template, `mat-table` at about lines 147–189, columns `['path','size','modified','status']` at about line 327).
- `GET /api/import/files?folder=...` returns the whole listing in one response (`ImportFiles {folder, items, more}`), at most 2,000 files (`maxFileListing`, backend `internal/ingest/folders.go`). With `more=true` the page shows the "more files" note.
- Paging is client-side: `fileList` → `pageIndex` → `pageFiles = fileList().slice(...)`, with `mat-paginator`. Choosing a folder resets to page 0.
- Order today is the backend's path order (`fs.WalkDir`, byte order): `u1, u10, u11, u2`. The frontend does not sort.
- `size` is bytes (number), `modified_at` is ISO UTC; both are formatted only in the template.
- Status is `new | in_library | original | not_audio`.
- Existing sortable headers to copy: `features/artists/artists-page.component.ts` (`matSort`, `[matSortActive]`, `[matSortDirection]`, `matSortDisableClear`, `matSortStart="asc"`, `(matSortChange)`, `mat-sort-header` with `[sortActionDescription]`). There the backend sorts; here a `computed` does.

## Design

- Sort state is a signal `{ active: 'path' | 'size' | 'modified' | 'status', direction: 'asc' | 'desc' }`, default `{ active: 'path', direction: 'asc' }`. No "unsorted" state (`matSortDisableClear`).
- The sort is kept when the manager switches folders (it lives in the component, not per folder). It is not stored in the URL or across page reloads.
- `sortedFiles = computed(...)` sits between `fileList` and `pageFiles`; `pageFiles` slices `sortedFiles`. Sort a copy, never the resource value.
- Comparators (direction flips the result; ties fall back to File ascending, so the order is stable and predictable):
  - **File** (`path`): natural order, `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })` created once: `u1, u2, …, u10`; case-insensitive. Compare the whole relative path, so files of a subfolder stay together.
  - **Size**: number.
  - **Modified**: `Date.parse(modified_at)`.
  - **Status**: explicit rank, ascending = `new`, `original`, `in_library`, `not_audio` (what needs action first). Not the translated label.
- Changing the sort returns to page 0 (as choosing a folder does).
- With `more=true` only the 2,000 listed files are sorted; the existing "more files" note covers this. No change.

## Steps

1. `import-page.component.ts`:
   - Import `MatSortModule` (and `Sort` type).
   - Table: `matSort [matSortActive]="sort().active" [matSortDirection]="sort().direction" matSortDisableClear matSortStart="asc" (matSortChange)="onSort($event)"`.
   - Each of the 4 header cells: `mat-sort-header` with `[sortActionDescription]="'import.folder.sortBy' | translate: { column: ('<column label key>' | translate) }"`.
   - `sort` signal, `sortedFiles` computed with the comparators above, `pageFiles` from `sortedFiles`, `onSort(event)` sets the signal (ignore an empty direction) and resets the page to 0.
   - Keep the comparator and status rank as small pure functions in the component file (or `import-sort.ts` next to it if the component grows too large); no new shared module.
2. i18n: `import.folder.sortBy` = "Sort by {column}" in `src/assets/i18n/en.json` and every other `<lang>.json` present.
3. Tests (`import.spec.ts`):
   - Default order is natural by path (`u1, u2, u10`) regardless of the response order.
   - Clicking Size / Modified / Status sorts ascending, a second click descending; Status uses the rank order; ties fall back to path.
   - Changing the sort returns to the first page.
   - Switching folders keeps the chosen sort.
4. `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. Check by hand in `npm run dev` on a folder with `u1…u40`.

## Report

- Files changed, the comparators as implemented, test results, and anything that differed from this plan.

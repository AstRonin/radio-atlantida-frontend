# Logs on Loki: frontend plan

Status: Draft, waiting for approval of `backend/docs/logs-loki-plan.md`
Companion to `backend/docs/logs-loki-plan.md` (read it first; §4.2 there defines the endpoint).
Replaces the file-based parts of `docs/f11-logs-plan.md` (file select, file links, 404 handling, offset paging, total).
Last updated: 2026-10-28

## Goal

The Logs page reads the backend's log through `GET /api/logs` (Loki) instead of the daily files. The operator chooses a time range, not a day. Error popups link to the log around the time of the error.

The backend sends the new `api/openapi.json` first (`make openapi`), then `npm run api:sync` here, and both are committed with this change, as the frontend CLAUDE.md requires.

## Current state (verified read-only, 2026-10-28)

- `src/app/features/logs/logs-page.component.ts`: a file select (`files`, `fileList`, default newest, `:323-381`), offset paging (`loadMore`, `LOG_MAX_OFFSET`, `:451-456`, `:49`), `total` for "load more" and "shown X of Y" (`:353`, `:166-171`), 404 reload of the file list (`:415-416`), query parameters `file`, `level`, `component`, `request` (`:305-308`).
- `src/app/core/logs/log-files.ts`: `logFileName()` (`:36-38`), `logLink()` (`:47-57`), which builds the popup link with `file` from the UTC date of the alert.
- `src/app/core/alerts/` (`error-alert-dialog.component.ts:40-52`): the "Open log" link from `logLink()`.
- `src/app/shared/ui`: `fileSize` pipe, used only by the logs page after F11. Remove it when the file select goes.
- `src/assets/help/en/logs.json`: describes the file and the UTC day.
- `src/assets/i18n/en.json`: `logs.*` keys for the file select, the UTC note, the offset limit and the 404 message.
- Routes, navigation, the Grafana link (F13) and the `help.logs` page ID stay.

## Changes

### 1. Filters: time range instead of the file

- A range control with presets: last hour, last 6 hours (default), last 24 hours, last 7 days. A custom range with two date-time inputs in the station zone is out of scope for this change (the presets cover the investigation cases; add the custom range if the owner asks for it).
- The range is sent as `from` and `to` (UTC instants converted from the station zone with `StationTimeService`). There is no maximum span in the panel; a range longer than the retention returns fewer lines, and a 422 `range_too_long` from the backend is shown as a field error on the range (`query.to`).
- `level` and `component` filters stay as they are (values from the generated types).
- A search box for `search` (text, up to 200 characters; sent as is, the backend escapes it).
- A request ID field for `request_id`, validated with the same pattern as the backend (a reactive validator mirroring the DTO rule).
- The URL keeps the range, level, component, search and request ID, so a link restores the page.

### 2. Paging: cursor instead of offset

- A "Load more" button while `next_cursor` is present.
- `total` is optional in the response (backend plan §3.8). When it is present, show "shown X of Y" as F11 does now; when it is absent, show only "shown X".
- A change of any filter reads the first page again.
- `LOG_MAX_OFFSET` and the offset limit text are removed.

### 3. Refresh and errors

- The Refresh button reads the first page again (as now).
- 503 `logs_unavailable`: the page shows the translated message "Logs are not available right now (the log store does not answer)" and keeps the last loaded entries. The retry button reads the first page again.
- 422 with field errors: field paths arrive as `query.<parameter>` (for example `query.from`, `query.search`); they are mapped to the form control of the same parameter name, with the `query.` prefix removed. A field error that has no control on the page is shown as a form-level message.
- The 404 path and the file list reload go away.

### 4. Error popup link

- `logLink()` returns query parameters: `from` = alert time minus 15 minutes, `to` = alert time plus 15 minutes (UTC), `component` if it is one of the log components, `request` = the alert's request ID.
- `logFileName()` is removed.
- The page reads `from`, `to`, `level`, `component`, `request` and `search` from the query parameters. Unknown values are ignored, as F11 decides.
- `request` now filters on the server (`request_id`), so the entry is found even when it is not on the first page. The row is still highlighted when it is shown.

### 5. Entries

- The table stays as in F11: time (station zone, `datetime-seconds`), level badge, component, message, error and request ID under the message, other `attrs` as `key: value`.
- No change in the entry shape: the backend keeps the `LogEntry` DTO.

### 6. Cleanup

- Remove `fileSize` and `formatFileSize` from `shared/ui` if no other page uses them (check with grep first; the import page used them before F11 moved them).
- Remove `log-files.ts` file helpers that only the file flow used; keep the component names and the `LOG_COMPONENTS` record, which must match the backend enum.

### 7. Help and translations

- `src/assets/help/en/logs.json`: replace the file and UTC-day text with the time range, the presets, the search and request ID fields, and the popup link (its window is 15 minutes either side of the error).
- `src/assets/i18n/en.json`: remove the file and offset keys; add the range presets, the search and request ID labels, the cursor "Load more", and the `logs_unavailable` message. No hard-coded strings.

## Tests

Next to the code, with `HttpTestingController` and no real HTTP:

- default range is the last 6 hours; presets set `from` and `to`;
- filters and search are sent in the query; the request ID is validated before sending;
- "Load more" sends `cursor` from `next_cursor` and appends the rows; no button when there is no cursor;
- a filter change reads the first page again;
- 503 shows the unavailable message and keeps the rows;
- 422 field errors appear on the controls;
- the popup link has `from`, `to`, `component` and `request`, and opening it sets the page's range and request ID;
- the URL restores the page state.

## Verification

Before finishing: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. Report the actual results.

## Order of work

1. Backend step 2 (`GET /api/logs` and `api/openapi.json` regenerated), which the frontend waits for.
2. `npm run api:sync`, then the changes above in one branch.
3. Tests and the four checks.
4. After backend step 3 (removal): the cleanup in §6 is already done here or in that change, whichever comes second. `grep` for `LOG_ROOT` and the file helpers finds nothing.

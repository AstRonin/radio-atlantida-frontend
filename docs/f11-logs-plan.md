# Phase F11 Plan — Logs (radio-atlantida-frontend)

Status: Done
Superseded by frontend/docs/logs-loki-plan.md (2026-10-29): the Logs page reads GET /api/logs from Loki; file select and offset paging are gone.
Based on: `docs/base.md`, `docs/tech-design.md` (§6.1, §10.1, §10.2), `docs/frontend-init-plan.md` §8 item 11
Last updated: 2026-10-15

## 1. Goal

When something did not work as expected, the manager reads the backend's diagnostic log in the
panel instead of on the station computer: chooses the day, narrows the entries by minimum level and
component, and reads each entry's time in the station timezone, its message, error, request ID,
and other fields. An error popup leads straight to the log of its day.

The backend side is complete: `GET /api/logs/files` (`LogFileList`: `name`, UTC `date`,
`size_bytes`, newest first) and `GET /api/logs/files/{name}` (`LogEntryPage`: `items`, `total`;
query `level` as a minimum, `component`, `limit` 1 to 1,000, `offset` up to 100,000; 404
`log_file_not_found`) are in `api/openapi.json`. The help page ID `help.logs` and its file already
exist (F4).

## 2. Decisions

1. **Logs page** (`/logs`, `features/logs`, help `help.logs`), last before Settings in the
   navigation (`nav.logs`). It reads; it changes nothing.
2. **File choice.** A select of the files as the backend lists them (newest first), each shown as
   its date and size. File dates are UTC (design §10.1) and the page says so next to the select,
   with the station zone used for the entry times. The newest file is chosen on open. No files:
   an empty state ("No log files yet").
3. **Filters.** `level` (minimum level, the spec's enum, "All" by default) and `component` (the
   spec's enum, "All" by default), named and typed after the query of `read-log-file`. A change
   reads the first page again. Values come from the generated types, never a hand-written list.
4. **Entries.** A table, newest first as sent: time (`stationTime`, `datetime-seconds`), level (a
   badge; ERROR and WARN marked), component, message, then the error and the request ID under the
   message, and the remaining `attrs` as `key: value` lines (objects as compact JSON). Pages of
   100 with offset; "Load more" while fewer than `total` are loaded, and "{shown} of {total}" above
   the table. Paging stops at the API's maximum offset.
5. **Refresh.** No event announces new log lines, so the page has a Refresh button that reads the
   file list and the first page again. A 404 (the file was removed by retention) shows the error
   and reads the file list again, so the select drops it.
6. **Links in.** The page reads `file`, `level`, `component`, and `request` from query parameters
   (router input binding). An unknown file or value is ignored. The row whose `request_id` equals
   `request` is highlighted. The error popup (`core/alerts`) gets an "Open log" link per alert:
   the file of the alert's UTC date, its component when it is one of the log components, and its
   request ID; following it closes the popup.
7. **File size pipe.** `fileSize` moves from `features/import` to `shared/ui`, because the logs
   page needs it too and features never import each other.
8. **Help and translations.** `logs.json` gains the `file` field and the popup link in its steps.
   Translations in `en.json`: `nav.logs`, `logs.*`, `alerts.dialog.openLog`.

## 3. Tasks

1. **`shared/ui`**: move `FileSizePipe` and `formatFileSize` (and their test) from
   `features/import`.
2. **Logs page**: file select with UTC note and empty state, level and component filters, entry
   table with attributes, offset paging with total, refresh, 404 handling, query parameters and
   the highlighted request.
3. **Error popup**: "Open log" link (`logLink()` in `core/alerts`), closing the dialog.
4. **Routes and navigation**: `logs` with `nav.logs`, before Settings.
5. **Help and translations** (decision 8).
6. **Tests** next to the code: file list and default newest file; empty state; level and
   component in the query; load more with offset and the total; refresh; 404 reads the list
   again; query parameters choose the file and filters and highlight the request; attributes are
   shown; the popup link's file, component, and request.

## 4. Out of scope

Searching message text on the server (the API has no text filter); following new lines live; the
Liquidsoap and Icecast logs (only the backend's log is served); downloading a file; changing the
log level (a setting, already on the settings page if the backend sends it).

## 5. Done when

The manager can choose a day's log, filter it by level and component, page through it with times
in the station zone, refresh it, and open the log of an error from its popup. `npm run lint`,
`npm run format:check`, `npm test`, and `npm run build` pass.

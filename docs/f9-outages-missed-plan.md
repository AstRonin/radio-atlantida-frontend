# Phase F9 Plan — Outages and Missed Items (radio-atlantida-frontend)

Status: Done
Based on: `docs/base.md` (Broadcast Failure Handling), `docs/tech-design.md` (§4, §4.1, §6.4 v7-6 and v7-13, §6.5, §7.1, §7.2, §10.2), `docs/frontend-init-plan.md` §8 item 9, backend `docs/phase-10-plan.md` (outages and missed items, done)
Last updated: 2026-10-15

## 1. Goal

The manager sees what actually aired: one played-tracks list with aired, truncated, and missed
items, where a missed item carries a clear "Not aired" label, its planned time, its clock, and the
outage that kept it off the air. The outage periods of the same range are listed next to it. Each
open missed item is resolved from the panel: rescheduled into a later planned hour (start, end, or a
fixed minute) or dismissed. The header shows how many missed items wait for a decision. The panel
shows the backend's records and never decides what aired.

The backend side is complete: `GET /api/play-history`, `GET /api/missed-items`,
`POST /api/missed-items/{id}/reschedule`, `POST /api/missed-items/{id}/dismiss`, `GET /api/outages`,
and the events `missed_items.*`, `playout_reconcile.*`, `reschedule.*`, `broadcast_outage.started`,
and `broadcast_outage.ended` are in `api/openapi.json`. The open-outage banner exists since F3.

## 2. Decisions

1. **Two pages**, after Filler reminders in the navigation: Played tracks (`/played-tracks`,
   `features/played-tracks`, help `help.played-tracks`) and Missed items (`/missed-items`,
   `features/missed-items`, help `help.missed-items`). Both help files exist; their field keys
   (`from`, `to`, `status`; `target_hour_start_utc`, `placement`, `fixed_minute`,
   `fixed_tolerance_ms`) are the control names.
2. **Range in station dates**, as the track plan (F7 decision 2): `from` .. `to` inclusive, default
   yesterday .. today, at most 31 days (`dateRangeValidator`), sent as station midnights in UTC
   (`stationMidnightUtc`).
3. **Played-tracks list.** Newest first, 100 rows a page with "Load more" (`next_cursor`), optional
   status filter (`aired`, `truncated`, `missed`). Columns: time (`started_at`, or the planned
   start for a missed item, with seconds), play button, title and artist, length (actual, or the
   planned length of a missed item), clock (link to its editor; "deleted clock" when the name is
   absent), source (`auto`, `live`, `emergency`), and status. A missed row is marked with a
   "Not aired" badge, the failed component and the outage reason, and its resolution; an open one
   links to the missed-items page.
4. **Outages of the range.** `GET /api/outages` reads at most 7 days, so the range is read in
   7-day chunks (at most five requests), merged by ID, newest first. Each row shows the start, the
   end (or "still open"), the failed component, what detected it, the reason, and how many items
   it kept off the air.
5. **Reload on events, not on every track.** Both lists reload on `missed_items.completed`,
   `playout_reconcile.completed`, `reschedule.completed`, and `broadcast_outage.started` /
   `broadcast_outage.ended` (outages only), all rare. Aired rows arrive with every track start, so
   the played-tracks list has a Refresh button instead of following `playout.now_playing` (a reload
   resets "Load more").
6. **Missed-item count in the header.** `MissedItemsService` (`core/alerts`, next to
   `OutageService`) holds the number of open missed items (`GET /api/missed-items`, at most 500)
   and `changes$` for the page. It reads when the event connection opens, on the events of
   decision 5, and on `refresh()` after a dismiss or a reschedule from the panel. The shell shows a
   "Not aired: N" link to `/missed-items` while N is above 0, like the filler reminders (F7).
7. **Missed-items page.** Resolution filter (`open` default, `rescheduled`, `dismissed`). Rows:
   planned time, play button, title and artist, planned length, clock, outage (component and
   reason), resolution and when. An open item has Reschedule and Dismiss.
8. **Dismiss** asks first (`ConfirmService.confirm` with the request as its action, so a refusal
   such as `missed_item_resolved` stays in the dialog), then refreshes.
9. **Reschedule** opens an inline form:
   - `target_hour_start_utc`: a select of the planned hours that have not started, read from
     `GET /api/track-plan` for the next 7 days (station time and clock name), reloaded on
     `track_plan.completed` and `clock_build.completed`. The backend refuses hours inside its frozen
     window or past the horizon; the panel does not repeat that rule.
   - `placement` (`start`, `end`, `fixed`); `fixed_minute` (0 to 59, required) and
     `fixed_tolerance_ms` (0 to 600000, optional, the backend default otherwise) are enabled only
     for `fixed`, so they are neither validated nor sent otherwise.
   - The request runs through `OperationsService.runOperation()` (a `reschedule`). Per-field 422
     errors land on the controls (`applySubmitError`); `missed_item_resolved` and `hour_started`
     are shown as the form error, and the list is refreshed for `missed_item_resolved`. The page
     shows a status line; a failed operation is already an `error.alert` popup (the track breaks a
     rule at its place or does not fit), so the form stays open for another target. On completion
     the form closes and the list refreshes.

## 3. Tasks

1. **`core/alerts`**: `MissedItemsService` (open count, `changes$`, `refresh()`), with tests.
2. **Shell**: the "Not aired" link in the header.
3. **Played-tracks page**: range and status form, paged list, outage list in chunks, Refresh,
   reload on events, empty and error states.
4. **Missed-items page**: resolution filter, list, dismiss with confirm, reschedule form with the
   target hour select and operation status, reload on `changes$`.
5. **Routes and navigation**: `played-tracks` and `missed-items` with `nav.playedTracks` and
   `nav.missedItems`, after Filler reminders.
6. **Translations** in `en.json` (`nav`, `playedTracks`, `missedItems`, `outages`).
7. **Tests** next to the code: the service (count, triggers); played tracks (request range in UTC,
   status filter, "Not aired" row with outage, load more with the cursor, outage chunks for a long
   range, reload on `missed_items.completed`); missed items (filter request, dismiss after
   confirm, target hours from the plan, reschedule body for `start` and `fixed`, field error on
   the control, refresh on completion).

## 4. Out of scope

Editing or deleting outages (the backend has no such endpoints); the logs page (F11); a timeline
chart of outages; rescheduling several items at once.

## 5. Done when

The manager can read what aired in a range up to 31 days with "Not aired" items marked and their
outages listed, see the number of open missed items in the header, dismiss a missed item, and
reschedule one into a planned hour at its start, end, or a fixed minute and see the result.
`npm run lint`, `npm run format:check`, `npm test`, and `npm run build` pass.

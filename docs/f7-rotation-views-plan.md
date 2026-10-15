# Phase F7 Plan — Rotation Views (radio-atlantida-frontend)

Status: Done
Based on: `docs/base.md` (planning horizons, filling a short clock), `docs/tech-design.md` (§4, §6.4 v7-11, §6.5, §7, §10.2), `docs/frontend-init-plan.md` §8 item 7, backend `docs/phase-8-plan.md` (rotation engine, done)
Last updated: 2026-10-15

## 1. Goal

The manager sees what the rotation engine planned: the concrete tracks of the coming hours, the
engine's warnings for each built hour, and the filler reminders that wait for an answer. A
reminder is answered with a track from the panel; the backend checks it against separation and
play rules and rebuilds the hour. A range of hours can be rebuilt on demand. As before, the panel
shows the plan and never computes it (CLAUDE.md, "Show, never recompute").

The backend side is complete: `GET /api/track-plan`, `POST /api/track-plan/rebuild`,
`GET /api/filler-requests`, `POST /api/filler-requests/{id}/answer`, and the events
`track_plan.warning` and `filler_request.created` are in `api/openapi.json`.

## 2. Decisions

1. **Two pages**: Track plan (`/track-plan`, `features/track-plan`, help `help.track-plan`) and
   Filler reminders (`/filler-reminders`, `features/filler-reminders`, help
   `help.filler-reminders`), placed after Grid in the navigation.
2. **Range in station dates.** The track plan is read for a range of station local dates `from` ..
   `to` (both inclusive, default today .. tomorrow, at most 7 days). The request uses the station
   midnights as UTC instants: `from` = start of the first date, `to` = start of the day after the
   last. The conversion is `stationMidnightUtc(date, zone)` in `core/time/local-date.ts`, computed
   with `Intl` in the station zone, never the browser zone.
3. **Warnings come only from events.** The plan response has no warnings; the engine sends
   `track_plan.warning` once per built hour that has warnings. `PlanWarningsService`
   (`core/rotation`) keeps the latest event per hour since the panel was opened (bounded, oldest
   hours dropped). The page shows an hour's warnings only when the event time is not older than
   the hour's `built_at`, so a later build without warnings hides them (the backend publishes the
   event after the build, with a later time). Warnings of hours built before the panel opened are
   not known; the page says so. Warnings are translated by `code` (`trackPlan.warnings.<code>`,
   element and segment numbers from 1), else the backend `message`.
4. **Live refresh without polling.** The plan reloads on `track_plan.completed` (the plan job,
   every 5 minutes) and `clock_build.completed` (any rebuild). The pending reminder count reloads
   on `filler_request.created`, those two events, a reconnect, and an answer. Deadlines pass
   inside the plan job, so `track_plan.completed` also covers reminders that were defaulted.
5. **Rebuild** (`POST /api/track-plan/rebuild`) uses the shown range and runs through
   `OperationsService.runOperation()` (a `clock_build`); the page shows a status line and reloads
   when it completes. A failure is already an `error.alert` popup. Hours that have started are not
   rebuilt by the backend; the page says so next to the button.
6. **Plan rows**: start time (station, with seconds), title, artist, play button, played length
   (`planned_out_ms`; a truncated item shows "cut" and the file length), source, and status. An
   hour heading shows the station time range, the clock (link to its editor), the build time, and
   a link to its reminder when `filler_request_id` is set.
7. **Pending reminder count** in the header: `FillerRemindersService` (`core/rotation`) holds the
   number of pending reminders; the shell shows a link to `/filler-reminders` while it is above 0.
   The count is the only shell addition; features never import each other.
8. **Answering a reminder.** A pending `short_clock` reminder has an Answer action that opens an
   inline form with the single track picker (`track_id`, required) and play buttons. The refusal
   `track_id: blocked` lands on the picker (`applySubmitError`). `filler_request_closed` and
   `hour_started` are shown as the form error and the list is reloaded. A `pool_empty` reminder
   cannot be answered (`filler_request_not_answerable`): it links to the clock editor, where the
   pool is refilled.
9. **Reminder list** with a status filter (`pending` default, `answered`, `defaulted`, `expired`,
   `all`): hour, clock (link), reason, mode, deadline, status. A pending reminder whose deadline
   has passed is marked "deadline passed"; the plan job closes it.

## 3. Tasks

1. **Station midnights.** `stationMidnightUtc(date, zone)` and `daysBetween(from, to)` in
   `core/time/local-date.ts`, with tests (fixed offset, a half-hour zone, a DST zone).
2. **`core/rotation`**: `PlanWarningsService` (warnings per hour from `track_plan.warning`,
   `forHour(hourStartUtc, builtAt)`), `FillerRemindersService` (pending count, `changed$` for the
   pages, `refresh()`), with tests.
3. **Track plan page**: range form (two `app-date-input`, validators: required, `to` ≥ `from`,
   at most 7 days), hours with their items and warnings, empty and error states, rebuild with
   operation status, reload on events.
4. **Filler reminders page**: status filter, list, answer form, pool-empty link, reload on
   `changed$`.
5. **Shell**: the pending reminder link in the header.
6. **Routes and navigation**: `track-plan` and `filler-reminders` with `nav.trackPlan` and
   `nav.fillerReminders`, after Grid.
7. **Translations** in `en.json` (`nav`, `trackPlan`, `fillerReminders`, `rotation`). Help files
   exist; field hints are checked against the control names (`from`, `to`, `track_id`).
8. **Tests** next to the code: local date conversion; warnings service (latest per hour, stale
   after a newer build); reminders service (count, refresh triggers); track plan page (request
   range in UTC, rows, warnings shown and hidden by `built_at`, rebuild body and reload, range
   validation); reminders page (filter request, answer body, `blocked` on the picker, pool-empty
   link, reload on `changed$`).

## 4. Out of scope

Played-tracks list, missed items and their reschedule target picker (outages phase); live control;
editing a planned hour by hand (the backend has no such endpoint).

## 5. Done when

The manager can read the plan of the next days with its sources, statuses, and warnings, rebuild a
range and see it complete, see the number of pending reminders in the header, answer a short-clock
reminder with a track (a refused track shows why), and reach the clock of a pool-empty reminder.
`npm run lint`, `npm run format:check`, `npm test`, and `npm run build` pass.

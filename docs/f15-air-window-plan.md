# Phase F15 Plan — Air Window (radio-atlantida-frontend)

Status: Done
Based on: backend `docs/phase-17-plan.md` (endpoint `GET /api/air-window`, settings `air.played_count` and `air.queued_count`, event `playout.track_ended` in §9), backend `docs/phase-9-plan.md` (now playing), backend `docs/phase-10-plan.md` (missed items, "Not aired"), `docs/tech-design.md` (§6.5 events), `docs/f8-live-control-plan.md` (Live page stays as it is), `CLAUDE.md`
Last updated: 2026-10-15

## 1. Goal

A separate panel view of the air as the manager needs it now: the last items that were due (including missed ones), the item on air with its progress, and the next planned items. Start and end times are shown in station time. The Live page is not changed.

## 2. Decisions (2026-10-15)

1. **Separate feature.** `features/air-window/`, route `/air-window`, a navigation entry (label "Air window"), help page ID `air-window`. Nothing in `features/live` changes.
2. **Presentational list** in `shared/air-window/air-window-list.component.ts`. Inputs: `rows`, `controlLinkConnected`. No HTTP, no services that call the API. It can be placed on another page later (for example the home page) without changes.
3. **Smart page** in `features/air-window/air-window-page.component.ts`. It loads `GET /api/air-window` through `ApiClient` with `rxResource`, shows load errors with `errorMessage()`, and owns the refresh.
4. **Refresh without polling.** The page reloads on these realtime events (names as in `core/realtime/realtime-events.ts`):
   - `playout.now_playing`: a track started, so the blocks moved;
   - `playout.track_ended` (new in backend phase 17 §9): a track left the air and its final status (`aired` or `truncated`) is written. Without it, a track with nothing after it (an empty plan, the end of an emergency track) would stay "On air";
   - `liquidsoap.state`: the control link changed, so `control_link_connected` and the now row change (the warning of 2.8);
   - `track_plan.completed`, `clock_build.completed` and `reschedule.completed`: the queued block may have changed (plan job, a clock or grid change, a rescheduled missed item);
   - `broadcast_outage.started`, `broadcast_outage.ended` and `missed_items.completed`: missed rows change.

   Events that arrive close together (an end and the next start come within milliseconds) cause one reload: the triggers are debounced (about 250 ms) and a reload in flight is replaced by the new one. The only timer is a one-second signal for the progress of the now row. It does not call the API. When the progress passes the row's end and no event has come, the row stays as it is (progress capped at 100 %); the page does not guess.
5. **No counts in the client.** The page does not send limits. The backend settings decide how many rows come back, and the page shows what it receives.
6. **Table in air order** (oldest at the top). Columns: Start, End, Status, Artist, Title, Source. Start and end use the `stationTime` pipe with the `time-seconds` format. If a row's date is not the station's today, its date is shown too; if the format needed is missing, add it to `StationTimeService` rather than formatting by hand.
7. **Status badges:**
   - `aired` shows "Aired";
   - `truncated` shows "Truncated";
   - `missed` shows "Not aired", and its resolution is shown as "Open", "Rescheduled" or "Dismissed";
   - `now` shows "On air", with progress as elapsed of out length (the same wording as the Live page's on-air block);
   - `queued` shows "In Liquidsoap" when `in_liquidsoap` is true, otherwise "Planned".
8. **Playout unknown.** When `control_link_connected` is false, a warning line says the playout status is unknown (Liquidsoap is not connected). The rows still show. An empty now row is not presented as "nothing is playing" in that state.
9. **Empty states.** No rows at all: "No plan for this time" with a link to the track plan. No now row while connected: "Nothing on air" inside the list, not a warning.
10. **Settings in the existing form.** A new group "Air window" in `features/settings/settings-form.ts`, with two number inputs from `shared/forms/number-input`:
    - `air.played_count`, 1 to 50, default 10;
    - `air.queued_count`, 0 to 50, default 9.

    Client validators mirror these limits, and the backend's per-field errors are shown on the same controls.
11. **Help.** `src/assets/help/en/air-window.json`, one worked example: what each badge means and what "Not aired" leads to (reschedule or dismiss on the missed-items page).

## 3. Files

| File | Change |
|------|--------|
| `src/app/features/air-window/air-window.routes.ts` | New, lazy route |
| `src/app/features/air-window/air-window-page.component.ts` | New, smart page |
| `src/app/features/air-window/air-window.spec.ts` | New |
| `src/app/shared/air-window/air-window-list.component.ts` | New, presentational list |
| `src/app/shared/air-window/air-window-list.spec.ts` | New |
| `src/app/app.routes.ts` | Lazy route `air-window` |
| `src/app/core/shell/navigation.ts` | Navigation entry |
| `src/app/core/help/help-content.ts` | Page ID `air-window` |
| `src/app/core/realtime/realtime-events.ts` | Add `'playout.track_ended': true` to `EVENT_TYPES` (the exhaustive record fails to compile after `api:sync` until it is added) |
| `src/app/features/settings/settings-form.ts` | Group "Air window", two fields |
| `src/app/features/settings/settings.spec.ts` | Range and save tests for the two fields |
| `src/assets/i18n/en.json` | Keys `airWindow.*` and the settings group label |
| `src/assets/help/en/air-window.json` | New |
| `api/openapi.json`, `src/app/core/api/generated/api.ts` | Regenerated with `npm run api:sync` from the backend phase 17 snapshot |

## 4. Tests

- **List (presentational):** rows in the given order; a badge for each kind and status; a missed row shows its resolution; the now row shows elapsed and out length; queued rows show "In Liquidsoap" or "Planned"; the warning appears when the control link is down and the rows still render; both empty states; times are rendered in the station zone (the test sets the station zone and checks the output).
- **Page:** loads through `rxResource`; each event named in 2.4 triggers a reload (fake realtime), `playout.track_ended` included; an end followed at once by a start causes one reload (debounce); an unrelated event (for example `import.completed`) causes none; a load error shows `errorMessage()`; leaving the page cancels the open request.
- **Settings:** the two fields accept and refuse values at the limits; saving sends the two values.
- Page tests use `flushHelp()` and `settlePage()` from `core/testing`.

## 5. Done when

- `/air-window` shows the backend's rows with the default 10 played, one now, and 9 queued, with start and end times in Asia/Yerevan.
- A missed item shows as "Not aired" with its resolution, and its link to the missed-items page works.
- Changing the counts in settings changes the list after the next reload event.
- `features/live` has no diff.
- Lint, unit tests and the production build pass; the help content test covers `air-window`.

## 6. Order

Backend phase 17 first, so that `api/openapi.json` carries the endpoint and the settings. Then this plan.

## 7. Out of scope

- The Live page.
- Placement on the home page (a one-line embed later, if the manager asks for it).
- A realtime event for the window itself.
- Using `playout.track_ended` on the Live page's on-air block (it would clear an ended track there too; a separate change if the manager asks).
- Track preview in the list.

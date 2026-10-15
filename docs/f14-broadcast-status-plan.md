# Phase F14 Plan — Broadcast Status in the Header (radio-atlantida-frontend)

Status: Done
Based on: backend `docs/phase-16-plan.md` (event `broadcast.state`, `GET /api/broadcast/status`), `docs/tech-design.md` (§6.5, §7.1), `docs/f8-live-control-plan.md` (live indicator), `docs/f9-outages-missed-plan.md` (outage banner, `OutageService`), `CLAUDE.md`
Last updated: 2026-10-15

## 1. Goal

The header shows whether the stream reaches Icecast, on every page: a colored dot, a short label, and a timer that counts how long the current state has lasted. The operator sees at a glance whether listeners hear the station, and whether it is retrying or down.

This indicator is separate from the two that exist: the connection status (the panel's WebSocket to the backend) and the live indicator (the operator's voice on air).

## 2. Decisions (2026-10-15)

1. **Placement.** In the shell header, after the "Not aired" and reminder links and before `app-live-indicator`. It is a status, not a page, so it has no help page and no navigation item.
2. **States and labels (English only: `en.json` is the only translation file).**

   | State | Dot | Label | Timer |
   |---|---|---|---|
   | `connected` | success (green) | Broadcasting | time since `since` |
   | `reconnecting` | warning (amber) | Reconnecting to Icecast | time since `since` |
   | `unreachable` | error (red) | Stream down | time since `since` |
   | `unknown` | outline (grey) | No status | none |

   Colors are never the only signal: the label carries the state.
3. **Colors.** Use theme tokens. If the theme has no amber or green token that is readable in both light and dark, add two tokens on `:root` with dark-mode overrides, as the rest of the shell does.
4. **Timer source.** The timer is `now - since`, where `now` is the server's clock. Each sync (the status read and each `broadcast.state` event carrying `time`) updates an offset: `offset = serverTime - Date.now()`. The displayed `now` is `Date.now() + offset`. A browser with a wrong clock then shows the right duration.
5. **Ticking.** One `setInterval` of 1 s, started only while the state has a `since`, and cleared on destroy. Change detection runs only for the timer text.
6. **Format.** `H:MM:SS`, hours unbounded (`27:14:03`). A day is not split into days.
7. **Tooltip.** Shows the station time of `since` (`StationTimePipe`, `datetime-seconds`), the reason when the backend gives one, and the mount check result (`mount_ok`, `last_check_at` as station time). Opens on hover and keyboard focus, so it works on desktop; on touch the label and timer are already visible.
8. **Accessibility.** The state label sits in an element with `role="status"` and `aria-live="polite"`. The timer is in a separate `aria-hidden` span, so screen readers announce changes of state, not each second.
9. **Narrow screens.** Below the existing `NARROW_QUERY` width the label is hidden and the dot and timer remain; the label is kept as visually hidden text.
10. **Startup and reconnect.** On each event connection the status is read once (`GET /api/broadcast/status`), as `OutageService` does. A read overtaken by an event is ignored (the same event counter guard).

## 3. Files

- `src/app/core/broadcast/broadcast.service.ts`: state signal, sync on connect, subscription to `broadcast.state`, clock offset.
- `src/app/core/broadcast/broadcast-status.component.ts`: the header component (dot, label, timer, tooltip).
- `src/app/core/broadcast/broadcast.service.spec.ts` and `broadcast-status.component.spec.ts`: state mapping, offset, timer with fake timers, hidden label at narrow width.
- `src/app/core/shell/shell.component.html` and `.ts`: place the component.
- `src/assets/i18n/en.json`: keys under `broadcast` (`state.*`, `since`, `reason`, `mount`).
- `api/openapi.json` and the generated client: copied from the backend and regenerated with the existing sync script. The types are never written by hand.
- `CLAUDE.md`: add F14 to the phase status line and to the list of plans.

## 4. Tasks

1. Confirm the backend contract (`broadcast.state`, `GET /api/broadcast/status`) is in `api/openapi.json`, then regenerate the client.
2. `BroadcastService`: read and event subscription, derived state signal, clock offset, state-to-label mapping.
3. Clock offset tests: a browser clock five minutes behind shows the correct duration.
4. `BroadcastStatusComponent`: markup, styles in both themes, timer with `setInterval` cleared on destroy.
5. Tooltip with station time and reason; keyboard focus opens it.
6. Narrow-width behaviour: label hidden, text kept for screen readers.
7. Place the component in the shell header; check the header does not overflow at phone width and has no horizontal page scroll.
8. Tests (`npm test`), lint (`npm run lint`), format (`npm run format:check`).
9. Update `CLAUDE.md` (phase status, plan list).

## 5. Done when

- With the stream playing, the header shows "Broadcasting" with a running timer on every page, in light and dark themes.
- Stopping the Icecast container shows "Reconnecting to Icecast" at once and "Stream down" after the outage opens; starting it again returns to "Broadcasting" and the timer restarts.
- Reloading the page mid-broadcast shows the same `since`, not zero.
- A browser clock set five minutes wrong still shows the right duration.
- At phone width the header fits, the label is hidden, and the dot and timer remain.
- Screen readers announce state changes and not the timer every second.
- Tests, lint and format pass.

## 6. Known limits

- Depends on backend phase 16. Until it is merged, the component shows "No status".
- The label cannot separate a failing retry from a retry that has not run yet (backend phase 16, §8).

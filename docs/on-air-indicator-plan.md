# Plan — On-Air Warning in the Header, Emergency Mark in the Air Window, Stale Title on Live (radio-atlantida-frontend)

Status: Requested by the operator (2026-11-10); not started
Based on: `docs/tech-design.md` (§8.6), backend `docs/safety-on-air-state-plan.md`
Last updated: 2026-11-10

## 1. Goal

1. The operator sees on every page that the emergency playlist is on air, or that only the safety tone is on air.
2. An emergency track stands out in the Air window as it does on Live.
3. Live stops showing a finished track as if it were still playing.

## 2. Decisions

1. **One indicator in the header**, in `core/shell`, next to the broadcast status. It is visible on every page, so the Track plan page needs no change of its own.
2. **Two states, the tone first.**
   - Safety tone on air (`safety_on_air`): red, "Nothing is playing: the safety tone is on air".
   - Emergency track on air (`now_playing.source == "emergency"`): amber, "Emergency playlist: <title>".
   - Otherwise nothing is shown.
3. **The data comes from one service in `core/`**, because features do not import each other: `GET /api/playout/status` on start and on WebSocket reconnect, then `playout.now_playing`, `playout.track_ended` and `playout.safety`.
4. **Not a popup and not a blocking banner.** Nothing blocks the operator's work.

## 3. Work

### 3.1 API snapshot

The backend change is delivered as a patch that may not be applied yet. Sync the specification from the path given in the brief with `npm run api:sync -- <path>`. Never edit `api/openapi.json` by hand.

### 3.2 Service and header

- The new service in `core/` holds the state with signals and tears down its subscriptions.
- On `playout.track_ended` for the current emergency track, or on any doubt, refetch the status rather than guess.
- The header component uses translated texts, an `aria-label`, and does not rely on colour alone (an icon or text says what it is). The title is truncated with the full text available.

### 3.3 Air window (`shared/air-window/air-window-list.component.ts`)

The source of an emergency row, on air or played, uses the same warning badge as Live (`on-air.component.ts`) instead of plain text. Keep the component presentational.

### 3.4 Live (`features/live/live-page.component.ts`)

Subscribe to `playout.track_ended` and refetch the status, so a finished track with nothing after it is cleared and its time stops. Keep the existing `playout.now_playing` handling.

### 3.5 Texts

Add the keys to `src/assets/i18n/en.json` and to any other language file. If the help of the Live or Air window page describes this, update it.

## 4. Tests

- Service: initial status; emergency start; its end clears the state; `playout.safety` on and off; refetch on reconnect; the tone takes priority over the emergency state.
- Header: nothing, amber with the title, red.
- Air window: an emergency row has the badge, a plan row does not.
- Live: `playout.track_ended` with nothing following shows the "nothing playing" state.

## 5. Done when

`npm run lint`, `npm test`, `npm run build` pass, and `npm run format:check` has no failure beyond files this task did not touch.

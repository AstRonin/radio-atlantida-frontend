# CLAUDE.md

Guidance for Claude Code sessions in `radio-atlantida-frontend`, the Angular management panel of the
Radio Atlantida automation system.

## Project context

Radio Atlantida is a radio automation system. This repository is its web management panel; the Go
backend (`radio-atlantida-backend`) holds all business logic, Liquidsoap plays the audio, Icecast
streams it, and PostgreSQL stores the data.

- **Library and playlists.** Tracks are grouped into playlists. A playlist is a pool, not a queue:
  track order does not matter, and a track can be in several playlists. Every playlist has a type
  (`music`, `jingle`, `news`, `segment`, plus types the manager adds). The panel has a play button to
  preview any track in the browser; previews never go to air.
- **Clocks and grid.** A clock is a 60-minute template: a set of playlists and timed inserts. Every
  playlist has a placement rule (`fill`, `spread` N, `start`, `end`, `start_end`, `middle`) that a
  clock may override; fill playlists may have shares. An insert is a track or a playlist at `mm:ss`
  with a start tolerance (±1 min by default). The grid assigns clocks to hours up to 30 days ahead;
  the backend lays out each hour and builds a rolling 24–48 h track plan (audio is never
  stretched; the last track before an insert or 60:00 is the best fit, else cut with a fade).
- **No filler.** The fill playlists fill the hour; when every fill track is blocked, the emergency
  steps apply and a warning is sent. One-time inserts (today's news) are added to a planned hour.
- **Play rules.** Named play rules (time window, track interval, artist interval, plays per hour)
  limit which track may play; separation is such a rule ("Music rotation"). Intervals are at most
  the play log retention.
- **Live voice** from the browser is mixed over the music.
- **Outages and missed items.** Stream interruptions are detected; items that did not air are marked
  missed and shown as "Not aired". The manager reschedules or dismisses them.
- **Operation.** One operator, **no authentication**. Runs in Docker on a Windows host; development
  is on macOS.

## Required reading at the start of every session

1. `docs/base.md`: the product requirements (the goal of every screen).
2. `docs/tech-design.md`: the technical design. **It is the authority.** §6 (API, help, validation,
   settings, track preview), §6.4 (client generation), and §10 (time and logging) matter most.
3. `docs/frontend-init-plan.md`: the task list of F1 to F5. Later phases have their own plan in
   `docs/` (F6: `docs/f6-clocks-grid-plan.md`, F7: `docs/f7-rotation-views-plan.md`, F8:
   `docs/f8-live-control-plan.md`, F9: `docs/f9-outages-missed-plan.md`, F10:
   `docs/f10-import-plan.md`, F11: `docs/f11-logs-plan.md`, F12: `docs/f12-release-plan.md`,
   F13: `docs/f13-grafana-link-plan.md`, F14: `docs/f14-broadcast-status-plan.md`, F15:
   `docs/f15-air-window-plan.md`, F16: `docs/f16-import-in-place-plan.md`, F17:
   `docs/f17-bulk-delete-plan.md`, F18: `docs/f18-library-pagination-sort-plan.md`, F19:
   `docs/f19-track-titles-review-weekdays-plan.md`, F20: `docs/f20-track-cue-editor-plan.md`, F21:
   `docs/f21-playlist-rules-clock-plan.md`).
   Work only on the current phase.

**If the code, the design, and the requirements disagree, stop and ask.**

Phase status: F1 (skeleton), F2 (API client and contract pipeline), F3 (realtime, operations,
alerts, settings core), F4 (shared UI: help, validation, pickers, player), F5 (settings and
library pages), F6 (clocks and grid, `docs/f6-clocks-grid-plan.md`), F7 (rotation views: track
plan, filler reminders, engine warnings, `docs/f7-rotation-views-plan.md`), F8 (live control:
live voice over WebRTC, music gain, on-air status, `docs/f8-live-control-plan.md`), F9
(outages and missed items: played-tracks list, outage list, reschedule and dismiss, open count in
the header, `docs/f9-outages-missed-plan.md`), F10 (import, analysis, and transcoding: import
page, quality facts and issues, Analyse / Fix loudness / Optimize track for selected
tracks, `docs/f10-import-plan.md`), F11 (logs: daily file, level and component filters,
station-time entries, "Open log" from the error popup, `docs/f11-logs-plan.md`), F12 (release
pipeline: a tag `vX.Y.Z` on `main` pushes `ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z` after
the full CI, only when `api/openapi.json` is the backend release of the same version,
`docs/f12-release-plan.md`), F13 (Grafana link: "Monitoring" in the navigation and "Search in
Grafana" on the Logs page, from the container's `GRAFANA_URL` served as `/config.json` and read by
`RuntimeConfigService` (`core/config`), `docs/f13-grafana-link-plan.md`), F14 (broadcast status
in the header: state, timer on the server clock, tooltip, from `broadcast.state` and
`GET /api/broadcast/status` in `BroadcastService` (`core/broadcast`),
`docs/f14-broadcast-status-plan.md`), F15 (air window: played, on-air, and queued items from
`GET /api/air-window` on the page `/air-window`, reloaded on playout, plan, and outage events
without polling; the list is `app-air-window-list` (`shared/air-window`); settings group "Air
window", `docs/f15-air-window-plan.md`), F16 (import in place: the manager chooses a folder of
the media root from `GET /api/import/folders`, sees its files and their status from
`GET /api/import/files`, and imports the new ones where they lie with a type, optional playlists,
and an optional artist; no inbox, `docs/f16-import-in-place-plan.md`), F17 (bulk track
delete: "Delete (N)" in the library selection bar sends one `POST /api/tracks/delete` for up to
1,000 tracks; deleted tracks leave the selection, refused ones stay selected with their reasons,
`docs/f17-bulk-delete-plan.md`), F18 (library pages and sort: `mat-paginator` and sortable
headers on the library, sorted and paged by the backend with `sort`, `order`, `offset`, and
`total` on `GET /api/tracks`; page, size, and order in the URL (`library-list-state.ts`); the
selection is kept across pages, `docs/f18-library-pagination-sort-plan.md`), F19 (track
titles, reviewed mark, "All" weekdays: a row "Rename" dialog that sends the whole track back with
`PUT`, "Rename (N)" find-and-replace previewed with `POST /api/tracks/rename` `dry_run`, the
"Reviewed" column, filter (`reviewed` in the URL), and "Mark reviewed (N)" / "Mark not reviewed
(N)" with `POST /api/tracks/review` (`track-review.ts`), a "Reviewed" switch on the track page
sent at once, and "All" in `app-weekdays-input`; the backend clears the mark,
`docs/f19-track-titles-review-weekdays-plan.md`), and F20 (track cue editor and usage marks:
"Start and stop" on the track page (`app-track-cue`, `@defer`) with the canvas waveform
`app-waveform-editor` (`shared/waveform`, peaks from `GET /api/tracks/{id}/waveform`, browser parts
behind `WAVEFORM_BROWSER`), `app-duration-input` (`m:ss.SSS`), Save with `PUT /api/tracks/{id}/cue`
then "Mark as reviewed", the plan rebuild followed; previews honour the cue and fades through a
`GainNode` (`PREVIEW_FADER_FACTORY`, faked in `fake-audio.testing.ts`); the library shows the on-air
length, In plan, on air / queued, and the playlist count, filters `in_plan` and `in_playlist=false`,
and reloads on playout and plan events; plan lengths are `out − in` (`plannedLength` pipe),
`docs/f20-track-cue-editor-plan.md`), and F21 (playlist placement rules, clock inserts, separation
in play rules: `app-clock-rule-input` on the playlist page and a rule badge in the list; the clock
editor of playlists with overrides and shares, timed inserts (`app-offset-input`, `mm:ss`;
`app-seconds-input` for tolerances), and the backend's sample hour and warnings; one-time inserts
in the track plan (`POST`/`DELETE /api/track-plan/inserts`, `hour_insert` operations);
`offset_ms` on missed-item reschedules; the artist interval and `app-interval-input` (hours and
minutes) on play rules; filler, filler reminders, and the Separation rules page removed,
`docs/f21-playlist-rules-clock-plan.md`) done. A page follows an operation it started (progress,
summary) with `followOperation()` (`core/operations`) and `app-operation-status` (`shared/ui`). The live
session is held by `LiveVoiceService` (`core/live`), not by the page, so it survives navigation;
browser media APIs are injected through tokens and faked in tests (`fake-live.testing.ts`). The
initialization plan ends with F5; later phases have their own plans.

## Ground rules

- **No authentication.** No login, guards, token storage, roles, or user menu. The API is reachable
  only on a private network.
- **The backend is the authority.** Never write REST or WebSocket payload types by hand. Types are
  generated from the backend OpenAPI snapshot (`api/openapi.json`) with `openapi-typescript`, and
  requests go through Angular `HttpClient` (no `openapi-fetch`, no other HTTP library).
  Use `ApiClient` (`core/api`) with spec paths (`api.get('/api/tracks/{id}', { path: { id } })`)
  and `ApiSchema<'Track'>` for DTO types. Live events come from `RealtimeService.on('<type>')`;
  start asynchronous operations with `OperationsService.runOperation()` (or `waitFor(id)` for an
  operation ID in a response, such as `build_operation_id`). A failed operation already raises an
  `error.alert` popup, so callers do not show their own. Errors arrive as `ApiProblem`; show them with
  `problemMessage()` and put field errors on forms with `applyServerErrors()` (`shared/forms`).
  Form control names match the DTO's JSON names. Format API times with the `stationTime` pipe or
  `StationTimeService`, never `DatePipe` or `toLocaleString` without the station zone.
- **Shared UI (F4).** Pages use these instead of their own: `app-page-header` (title and help
  button; page IDs are `HelpPageId` in `core/help`), `app-field-hint`, the inputs in `shared/forms`
  (number, time, date, weekdays, hours, duration, offset `mm:ss`, seconds, interval, clock rule,
  playlist type) with `shared/forms/validators.ts`, the pickers in `shared/pickers`,
  `app-play-button` for track preview, and `ConfirmService` for deletes (it shows `used_by`
  refusals). Shared lists are read through `CatalogService` (`core/catalog`), so `shared/` never
  calls HTTP itself.
- **Pages (F5).** Lists load with `rxResource` and `reload()` after a change; show load errors
  with `errorMessage()` (`core/api`) and save errors with `applySubmitError()` (`shared/forms`).
  Edit pages implement `PendingChanges`, call `warnBeforeUnload()`, and their routes use
  `unsavedChangesGuard`. Text fields use `app-text-input`. Page tests use `flushHelp()` and
  `settlePage()` from `core/testing`; `whenStable()` hangs while a resource request is open.
- **No secrets in the frontend.** The panel only shows whether a secret is set.
- **Times.** The API sends ISO 8601 UTC (`...Z`). Display them in the station timezone from settings
  (IANA name, default `Asia/Yerevan`), never in the browser's zone. Station local dates
  (`YYYY-MM-DD`, the grid) use `core/time/local-date.ts` (`stationToday`, `addDays`, `weekdayOf`).
- **Show, never recompute** clock and station rules: send the template, show the backend's sample
  hour and warnings.
- **Forms validate twice:** reactive-form validators mirroring the DTO rules, then the backend's
  per-field errors on the same controls. Save is disabled while the form is invalid.
- **Help is static** JSON in `src/assets/help/<lang>/`, shipped with the release.
- **Nothing blocks the air.** The panel is not in the playout path.
- **Languages.** No user-visible string is hard-coded. Use translation keys (dotted paths) from
  `src/assets/i18n/<lang>.json` with the `translate` pipe or `I18nService.translate()`. Default `en`;
  missing keys fall back to English. Backend errors are translated by their `code`, else `detail`.
- **Dependencies.** Prefer the Angular platform, Angular CDK, and Angular Material. Every new
  third-party dependency needs a reason in the PR description.

### Angular

- Standalone components only, `ChangeDetectionStrategy.OnPush` everywhere, zoneless change detection.
- Organize by domain (`features/library`, `features/playlists`, ...). App-wide services live in
  `core/`, presentational building blocks in `shared/`. No `shared/utils` dumping ground.
- Keep smart (routes, data loading) and presentational (inputs and outputs, no HTTP) components apart.
- Every feature page is a lazy route; the router preloads all lazy chunks after the first render
  (`PreloadAllModules`). Use `@defer` for heavy parts of a page not needed for its first view.
  A feature's public API is its routes file; features import only from `core` or `shared`, never
  from each other.
- Signals for state, `computed` for derived values, RxJS for streams (WebSocket, cancellable HTTP,
  debounced input). No `subscribe` without teardown (`takeUntilDestroyed`, `async`, `toSignal`).
  Cancel HTTP calls when leaving a page.
- Reactive forms only. Map backend `errors[].field` paths (e.g. `elements[2].fixed_minute`) to controls.
- HTTP errors are RFC 9457 problems converted once by an interceptor into `ApiProblem`; components
  never parse raw HTTP errors. `error.alert` events are popups; open outages are a persistent banner.
- Strict TypeScript (`strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
  `noImplicitReturns`) and `strictTemplates`. No `any`; use `unknown` and narrow.
- Accessibility: every control has a label, icon-only buttons have `aria-label`, focus is visible,
  dialogs trap focus. Target WCAG 2.1 AA.
- Angular style guide file names (`*.component.ts`, `*.service.ts`, `*.routes.ts`, kebab-case).
- Unit tests next to the code (Vitest via `ng test`), using Angular testing utilities and
  `HttpTestingController`. No real HTTP or WebSocket in unit tests.
- Comments explain why, not what.

### Node and build

- Node LTS pinned in `.nvmrc` (24.21.0) and `package.json` `engines`. `package-lock.json` is
  committed; CI uses `npm ci`.
- Exact versions for direct dependencies (no `^` or `~`).
- `npm audit --audit-level=high` runs in CI.
- Line endings are LF (`.gitattributes`, checked in CI).

## Layout

```
.github/workflows/ci.yml     lint, format, typecheck, tests, build, audit, Docker smoke test
.github/workflows/release.yml  tag vX.Y.Z -> CI -> image ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z
api/openapi.json             backend specification snapshot (committed, never edited by hand)
docker/Dockerfile            Node build -> unprivileged nginx on port 8080
docker/default.conf.template nginx: static files, SPA fallback, /api and /api/ws proxy, security
                             headers, /config.json from GRAFANA_URL (rendered at container start)
docs/                        context documents (kept verbatim, not formatted by Prettier)
scripts/sync-api.mjs         copies the backend specification into api/
src/app/core/                app-wide services: api, config (runtime config.json), realtime,
                             operations, alerts (errors, open
                             outage, open missed items), settings, time, logs (log file names,
                             levels, components, popup links),
                             player, help, catalog (lists for pickers), rotation (plan warnings),
                             live (voice session, header mark),
                             broadcast (stream state and timer in the header), i18n,
                             shell, testing
src/app/shared/              ui, forms, pickers, air-window (presentational only)
src/app/features/            one folder per domain, created when its phase starts
src/app/app.routes.ts        lazy routes; a route with data.navLabel appears in the navigation
src/app/app.config.ts        router, HttpClient with interceptors, error handler, translations
src/assets/i18n/             <lang>.json translations and languages.json
src/assets/help/<lang>/      help JSON per page ID: help.play-rules -> play-rules.json
proxy.conf.json              dev proxy: /api (and /api/ws) -> http://127.0.0.1:8090
```

Empty folders are not committed. Register a route only in the phase that builds its page.

## npm scripts

| Script                 | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Dev server on http://localhost:4200 with the `/api` proxy |
| `npm run lint`         | ESLint (`angular-eslint`, `typescript-eslint`)            |
| `npm run format`       | Prettier write; `format:check` verifies                   |
| `npm run typecheck`    | TypeScript check of app and spec sources                  |
| `npm test`             | Unit tests, single run (`test:watch` for watch mode)      |
| `npm run build`        | Production build into `dist/radio-atlantida-frontend/`    |
| `npm run api:sync`     | Copy the backend OpenAPI specification into `api/`        |
| `npm run api:generate` | Generate types into `core/api/generated/` (git-ignored)   |

`dev`, `build`, `test`, `test:watch`, and `typecheck` run `api:generate` first, so they always start
from fresh types.

After a backend DTO or endpoint change: `make openapi` in the backend, then `npm run api:sync`
(default source `../radio-atlantida-backend/api/openapi.json`, or `npm run api:sync -- <path>`), and
commit `api/openapi.json` with the frontend change that uses it. The compiler shows what must change.

`openapi-typescript` declares a peer of TypeScript 5; the `overrides` entry in `package.json` makes
it use the project's TypeScript. Remove the override once a release supports TypeScript 6.

Before finishing any change: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.

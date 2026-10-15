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
- **Clocks and grid.** A clock is a 60-minute template of elements. Each element takes a track from
  one or more playlists and is placed at the start, the end, a fixed minute (±1 min), or in flow.
  The grid assigns clocks to hours up to 30 days ahead; the backend builds a rolling 24–48 h track
  plan from it, fitting tracks by duration tolerance (audio is never stretched).
- **Filler.** A clock saved short opens a blocking dialog to choose a filler mode (pool, playlist,
  artist, random, ask). Otherwise it is saved incomplete and reminders are created.
- **Rotation and play rules.** Separation rules (for example, a track at most once per 3 days) and
  named play rules (time window, minimum interval, plays per hour) limit which track may play.
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
   `docs/f10-import-plan.md`, F11: `docs/f11-logs-plan.md`). Work only on the current phase.

**If the code, the design, and the requirements disagree, stop and ask.**

Phase status: F1 (skeleton), F2 (API client and contract pipeline), F3 (realtime, operations,
alerts, settings core), F4 (shared UI: help, validation, pickers, player), F5 (settings and
library pages), F6 (clocks and grid, `docs/f6-clocks-grid-plan.md`), F7 (rotation views: track
plan, filler reminders, engine warnings, `docs/f7-rotation-views-plan.md`), F8 (live control:
live voice over WebRTC, music gain, on-air status, `docs/f8-live-control-plan.md`), F9
(outages and missed items: played-tracks list, outage list, reschedule and dismiss, open count in
the header, `docs/f9-outages-missed-plan.md`), F10 (import, analysis, and transcoding: inbox
and import page, quality facts and issues, Analyse / Fix loudness / Optimize track for selected
tracks, `docs/f10-import-plan.md`), and F11 (logs: daily file, level and component filters,
station-time entries, "Open log" from the error popup, `docs/f11-logs-plan.md`) done. A page follows an operation it started (progress,
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
  (number, time, date, weekdays, filler mode, playlist type) with `shared/forms/validators.ts`, the
  pickers in `shared/pickers`, `app-play-button` for track preview, `ConfirmService` for deletes (it
  shows `used_by` refusals), and `FillerDialogService` for the blocking filler dialog. Shared lists
  are read through `CatalogService` (`core/catalog`), so `shared/` never calls HTTP itself.
- **Pages (F5).** Lists load with `rxResource` and `reload()` after a change; show load errors
  with `errorMessage()` (`core/api`) and save errors with `applySubmitError()` (`shared/forms`).
  Edit pages implement `PendingChanges`, call `warnBeforeUnload()`, and their routes use
  `unsavedChangesGuard`. Text fields use `app-text-input`. Page tests use `flushHelp()` and
  `settlePage()` from `core/testing`; `whenStable()` hangs while a resource request is open.
- **No secrets in the frontend.** The panel only shows whether a secret is set.
- **Times.** The API sends ISO 8601 UTC (`...Z`). Display them in the station timezone from settings
  (IANA name, default `Asia/Yerevan`), never in the browser's zone. Station local dates
  (`YYYY-MM-DD`, the grid) use `core/time/local-date.ts` (`stationToday`, `addDays`, `weekdayOf`).
- **Show, never recompute** clock and station rules: send the template, show the backend's dry check,
  warnings, and filler choices.
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
api/openapi.json             backend specification snapshot (committed, never edited by hand)
docker/Dockerfile            Node build -> unprivileged nginx on port 8080
docker/nginx.conf            static files, SPA fallback, /api and /api/ws proxy, security headers
docs/                        context documents (kept verbatim, not formatted by Prettier)
scripts/sync-api.mjs         copies the backend specification into api/
src/app/core/                app-wide services: api, realtime, operations, alerts (errors, open
                             outage, open missed items), settings, time, logs (log file names,
                             levels, components, popup links),
                             player, help, catalog (lists for pickers), rotation (plan warnings,
                             pending filler reminders), live (voice session, header mark), i18n,
                             shell, testing
src/app/shared/              ui, forms, pickers (presentational only)
src/app/features/            one folder per domain, created when its phase starts
src/app/app.routes.ts        lazy routes; a route with data.navLabel appears in the navigation
src/app/app.config.ts        router, HttpClient with interceptors, error handler, translations
src/assets/i18n/             <lang>.json translations and languages.json
src/assets/help/<lang>/      help JSON per page ID: help.play-rules -> play-rules.json
proxy.conf.json              dev proxy: /api (and /api/ws) -> http://127.0.0.1:8080
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

# Phase F13 Plan — Grafana Link (radio-atlantida-frontend)

Status: Done
Based on: `docs/tech-design.md` (§10.3, §10.4, §9), backend `docs/phase-14-plan.md` (Grafana, dashboard `radio-database`) and `docs/phase-15-plan.md` (Loki, dashboard `radio-logs`), deploy plan decision 8.12
Last updated: 2026-10-15

## 1. Goal

The operator reaches the station's Grafana from the panel instead of typing its address: a
"Monitoring" link in the navigation opens Grafana, and the Logs page links to Grafana's "Logs"
dashboard for text search and history across days (design §10.4: Grafana complements the Logs
page, it does not replace it). When monitoring is off, no link is shown.

The backend and the deploy side need no change for the panel to work: Grafana is bound to
`127.0.0.1` on the station machine (port `GRAFANA_PORT`, default 3000), the panel is opened on the
same machine (deploy plan §8.1), and the dashboards have fixed UIDs (`radio-database`,
`radio-logs`). The deploy repository sets one variable on the frontend service (§4).

## 2. Decisions (2026-10-15)

1. **The address comes from the frontend container, not from the backend.** Grafana is not part of
   the backend's API, and the backend code does not change for monitoring (design §10.3). The
   address is not hard-coded either: the port is set in `.env`, and monitoring can be switched off.
   The frontend image reads `GRAFANA_URL` at container start (empty or unset: monitoring off).
2. **Runtime configuration as `/config.json`.** nginx serves `{"grafana_url":"…"}` at
   `/config.json`, filled from the environment when the container starts (the nginx image's
   `templates/` envsubst, limited to `GRAFANA_URL` by `NGINX_ENVSUBST_FILTER`, so nginx's own
   `$variables` are untouched). Not cached. The panel image stays the same for every station.
3. **`RuntimeConfigService` (`core/config`)** reads `config.json` once at startup, without blocking
   the first render, with `HttpClient` (it is not an API path, so no `ApiProblem` and no error popup). A missing
   file (the dev server), a parse error, or a value that is not an absolute `http:` or `https:`
   URL means "no link"; nothing is reported, because monitoring is optional and never blocks the
   panel. The trailing slash is removed.
4. **Navigation link.** Below the pages, separated by a divider: "Monitoring", opening Grafana's
   home in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), with a visually hidden
   "(opens in a new tab)" and an ↗ mark. Grafana asks for its own login (design §10.3).
5. **Logs page link.** "Search in Grafana" in the page header actions, opening `/d/radio-logs` in
   a new tab, only when the address is set. The help of the Logs page says what Grafana adds
   (text search, several days, errors per component over time).
6. **CSP and headers unchanged.** A link that navigates to another origin is not limited by the
   panel's `Content-Security-Policy`; `Referrer-Policy: no-referrer` stays.
7. **Dev.** `ng serve` has no `/config.json`, so no link. To try it, create `public/config.json`
   (git-ignored and not copied into the image) with the dev Grafana address
   `http://127.0.0.1:3000`.
8. **Design.** `docs/tech-design.md` is synced to v7-17 from the backend (it adds §10.3 and §10.4)
   and §10.3 gains a "Panel link" paragraph with decisions 1 and 4 (v7-18). The other repositories' copies
   get the same paragraph.

## 3. Files

| File                                    | Change                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `docker/nginx.conf` → `default.conf.template` | `location = /config.json` with `${GRAFANA_URL}`; copied to `/etc/nginx/templates/` |
| `docker/Dockerfile`                     | `ENV GRAFANA_URL=""`, `NGINX_ENVSUBST_FILTER`; template instead of `conf.d`    |
| `.github/workflows/ci.yml`              | smoke test also checks `/config.json` with `GRAFANA_URL` set                   |
| `src/app/core/config/`                  | `RuntimeConfigService` (`grafanaUrl` signal), `grafanaUrlOf()`, tests           |
| `src/app/core/shell/`                   | "Monitoring" link in the navigation                                            |
| `src/app/features/logs/`                | "Search in Grafana" header link                                                |
| `src/assets/i18n/en.json`, `help/en/logs.json` | `shell.monitoring`, `common.opensInNewTab`, `logs.openGrafana`; help text |
| `.gitignore`, `.dockerignore`           | `public/config.json`                                                           |
| `docs/tech-design.md`, `README.md`, `CLAUDE.md` | design paragraph; `GRAFANA_URL`; phase status                          |

## 4. Follow-ups in other repositories

- **Deploy:** the `frontend` service gets `GRAFANA_URL=http://127.0.0.1:${GRAFANA_PORT}` when
  `MONITORING_ENABLED=true`, and an empty value otherwise. Until then the panel shows no link.
- **Backend, deploy, docs:** their copies of `docs/tech-design.md` get the §10.3 "Panel link"
  paragraph (v7-18).

## 5. Out of scope

Embedding Grafana panels in the panel (Grafana requires its own login, and the panel's CSP forbids
frames); a health indicator for Grafana; deep links from a log entry to a Loki query; a Grafana
address from the backend's settings.

## 6. Done when

With `GRAFANA_URL=http://127.0.0.1:3000` the image serves `/config.json` with that address and the
panel shows "Monitoring" in the navigation and "Search in Grafana" on the Logs page, both opening a
new tab; without it, `/config.json` has an empty address and neither link appears; an invalid
value or a missing file shows no link and no error. Lint, format, tests, build, and the Docker
smoke test pass.

# Plan — Deploy Prerequisites: Release Compatibility, Stream Settings Texts, Multi-arch Image (radio-atlantida-frontend)

Status: Approved scope (deploy plan and tech-design v7-24, 2026-11-12); not started
Based on: `docs/tech-design.md` v7-24 (§1.1, §6.3, §6.4, §8.8, §9.2, §11 items 32–33, 37), `radio-atlantida-docs/deploy/docs/deploy-init-plan.md` (§10.1, §10.2, §11.7, §11.18, §12 cross-repo tasks F1–F4), `docs/f12-release-plan.md` (release pipeline), backend `docs/deploy-prereqs-plan.md` (A1 `stream.icecast_tls`, A8 descriptions, Phase C multi-arch)
Last updated: 2026-11-12

## 1. Goal

The deploy repository installs `BACKEND_TAG` and `FRONTEND_TAG` separately, pinned by the digest of a multi-arch manifest list, and checks that the two are compatible (same MAJOR.MINOR). The frontend must:

- be releasable without a backend release of the same patch version (F1);
- say in its image which backend API it was built against (F2);
- show the new TLS stream setting and say correctly what a stream setting change does (F3);
- publish one image tag for `linux/amd64` and `linux/arm64` (F4).

**Precondition (not part of this plan):** the uncommitted working-tree changes are committed first: `docker/Dockerfile` (the `COPY` of `docker/default.conf.template`, `:26`; the working tree drops the `--chmod=644` that `HEAD` has, see §6), `.github/workflows/ci.yml` and `.github/workflows/release.yml` (the `/config.json` checks), `package.json`/`package-lock.json` (`@angular/build` and `@angular/cli` 22.2.6).

## 2. Decisions (2026-11-12)

1. **Compatibility rule: same MAJOR.MINOR.** A frontend `X.Y.Z` may ship an API snapshot (`api/openapi.json` `info.version`) of any backend `X.Y.*`. An API change bumps at least the backend MINOR (deploy plan §10.2, §11.7).
2. **F2 is kept, as a label.** It costs one build argument: the image carries `io.radio-atlantida.api-version` = the snapshot's `info.version`. The deploy tool can then require backend ≥ that version within the same MAJOR.MINOR. Until the tool reads it, the MAJOR.MINOR rule alone applies.
3. **F3 is texts only.** The settings page already builds its fields from `GET /api/settings`, shows the "reconnect" confirmation (`src/app/features/settings/settings-page.component.ts:436-446`) and the notice (`src/app/core/settings/settings.service.ts:114-128`); a new boolean setting renders like `stream.hls_enabled`. Only the label, the help texts, and the wording change.
4. **F4: native runners, like the backend's Phase C.** The repository is public, so `ubuntu-24.04` and `ubuntu-24.04-arm` runners are free. Each runner builds and smoke-tests its own platform natively (no QEMU); the images are pushed by digest and joined into one manifest list. The node stage is architecture-independent (`FROM --platform=$BUILDPLATFORM`), so the Angular build output is the same on both.

## 3. Steps

Steps are in dependency order. None blocks the deploy phases D3 or D4 directly; F1, F3, and F4 must be done before the first release `v1.0.0`, which deploy D4's first run and the arm64 dry run (D7) need.

### F1. Release check: compatibility instead of equality

- `.github/workflows/release.yml` step "API snapshot is the backend release of the same version" (`:43-52`): rename to "API snapshot is a backend release of the same MAJOR.MINOR"; compare `${VERSION%.*}` with the snapshot's `info.version` without its patch (`jq -r '.info.version' api/openapi.json`); also refuse a snapshot that is not `X.Y.Z` (for example `dev`). The error says to run `npm run api:sync -- <openapi.json of a backend X.Y.* release>`.
- The comment above it (`:44`) changes from "Both images share one IMAGE_TAG" to the rule of decision 1.
- The GitHub release notes (`release` job, `:108-122`; the notes line is `:122`) say "Deploy with a backend `X.Y.*`: set `FRONTEND_TAG` in the deploy repository's `release.env`" instead of `update.bat $VERSION`.
- `docs/f12-release-plan.md` §2 and §4 (runbook) and the F12 line of `CLAUDE.md` ("only when `api/openapi.json` is the backend release of the same version") are updated in the same change: the frontend tag no longer has to equal the backend tag.

### F2. API version label

- `docker/Dockerfile` runtime stage (`:13-21`): `ARG API_VERSION=unknown` and the label `io.radio-atlantida.api-version="${API_VERSION}"`.
- `.github/workflows/release.yml` build (`:76-81`, the `docker build` at `:78`, or the buildx command of F4): `--build-arg API_VERSION="$(jq -r '.info.version' api/openapi.json)"`; the smoke step checks the label like the version label (`:83-87`).
- `.github/workflows/ci.yml` image build (`:58`): the same build argument, so the label is tested on every PR.

### F3. Stream settings texts (with backend A1 and A8)

- `src/assets/i18n/en.json` `settings.fields.stream` (`:181-194`): `"icecast_tls": "Icecast over TLS"`.
- `src/assets/help/en/settings.json`:
  - new `stream.icecast_tls`: label "Icecast over TLS", text "Connect to the stream server over HTTPS. The station's server needs it; a test server usually does not."
  - the "Apply mode" text (`:11`) and the example "Moving to a new stream server" (`:35-36`): "Stream settings apply at once: the stream reconnects to the server with the new values, with a gap of a few seconds. Playout is not restarted."
  - `stream.loudness_target_lufs` (`:78-80`): "The target loudness of the tracks. The import checks tracks against it and Fix loudness uses it; the stream itself is not normalised."
  - `stream.hls_enabled` (`:94-96`): "Reserved: HLS output is not implemented yet; this value has no effect."
- `src/assets/i18n/en.json` `settings.reconnectNotice` (`:136`) and `settings.reconnect.message` (`:168`): "… takes effect at once: the stream reconnects with a gap of a few seconds." The confirmation dialog stays (the stream is interrupted briefly).
- Tests: `src/app/core/settings/settings.service.spec.ts` (the notice test at `:98-109` keeps the key, the text is not asserted); `src/app/features/settings/settings.spec.ts`: a boolean `stream.icecast_tls` from the list renders as a toggle with its translated label and saves through the reconnect confirmation.
- `npm run api:sync` with the backend release that adds `stream.icecast_tls` (the setting is data in `GET /api/settings`; the snapshot changes only if the backend's settings schema does).

### F4. Multi-arch image (native runners)

- `docker/Dockerfile:4`: `FROM --platform=$BUILDPLATFORM node:24.21.0-alpine AS build` (the build output is static files, the same on every platform). The runtime stage (`:12`) stays per platform; it only copies files.
- `.github/workflows/ci.yml` "Check Node version of the image" (`:32-39`): the `sed` pattern `^FROM node:` no longer matches; change it to `^FROM --platform=\$BUILDPLATFORM node:\([^-]*\)-.* AS build$`.
- `.github/workflows/ci.yml` job `docker` (`:54-80`): a matrix over `ubuntu-24.04` (`linux/amd64`) and `ubuntu-24.04-arm` (`linux/arm64`); each builds the image natively and runs the existing serve and `/config.json` checks against it.
- `.github/workflows/release.yml` job `image` (`:58-106`):
  - "Image tag is not taken" (`:70-75`) moves before the matrix and uses `docker buildx imagetools inspect "$IMAGE:$VERSION"` (a manifest list).
  - A matrix over the two runners: build natively with the `VERSION`, `REVISION`, `CREATED`, and `API_VERSION` arguments, run the label, `/`, and `/config.json` checks (`:82-104`), push by digest only (`--output type=image,name=$IMAGE,push-by-digest=true,name-canonical=true,push=true`), upload the digest.
  - A job `manifest` after both: `docker buildx imagetools create -t "$IMAGE:$VERSION" $IMAGE@<amd64 digest> $IMAGE@<arm64 digest>`; `imagetools inspect` must list both platforms; print the manifest list digest for the deploy repository's `release.env`.
- `docs/f12-release-plan.md` §2: images are multi-arch; the digest to pin is the manifest list's.

### F5. `CLAUDE.md`

- "Required reading", item 3: add `docs/deploy-prereqs-plan.md` (deploy prerequisites: release compatibility, API version label, stream settings texts, multi-arch image).
- "Phase status", the F12 sentence: replace "only when `api/openapi.json` is the backend release of the same version" with "only when `api/openapi.json` is a backend release of the same MAJOR.MINOR; the image is multi-arch (`linux/amd64`, `linux/arm64`) and carries the API version label".
- "Layout", `.github/workflows/release.yml`: "tag vX.Y.Z -> CI -> multi-arch image ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z".

## 4. Tests

- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`.
- The settings spec of F3.
- CI's image job builds and serves both architectures on native runners; on a test tag in a fork (tags are immutable in the real registry), the release job publishes one manifest list with both platforms.

## 5. Order of work

1. F3 after the backend's A1 and A8 are merged (labels and texts for the new key and descriptions).
2. F1 and F2 (one PR: release workflow and Dockerfile label).
3. F4 (Dockerfile platform line, CI and release workflows).
4. F5 (`CLAUDE.md`) in the same PRs as the rules it describes (F1 and F4).
5. Release `v1.0.0` after the backend's `v1.0.0` (snapshot from it via `npm run api:sync`).

## 6. Done when

- The CI and release workflows pass; a frontend tag `X.Y.Z` with a snapshot of backend `X.Y.W` (W ≠ Z) is accepted, a snapshot of another MINOR is refused.
- `docker buildx imagetools inspect ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z` lists `linux/amd64` and `linux/arm64`; both serve `/` and `/config.json`; both carry the version and API version labels.
- The settings page shows "Icecast over TLS" and the new help texts.
- `CLAUDE.md` is updated (F5).
- Open point for the developer: the working tree removes `--chmod=644` from the template `COPY` that `HEAD` has (`docker/Dockerfile:26`). If that is intended (the CI fix), it stays; otherwise restore it before the precondition commit.

## 7. Out of scope

- Any change to how settings are rendered or saved.
- Live voice changes for the Windows 10 NAT mode (the browser gets the VM address from the backend's answer; nothing changes in the panel).
- The deploy repository's own CI and tools.

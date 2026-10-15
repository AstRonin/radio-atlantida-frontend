# Phase F12 Plan — Release Pipeline (radio-atlantida-frontend)

Status: Done (the release path itself runs only on a real tag; see §5)
Based on: `docs/tech-design.md` (§1.1, §6.4, §9.2), `docs/frontend-init-plan.md` §8 item 12 and §9.2, backend `docs/phase-13-plan.md` (release pipeline, done), deploy plan (`IMAGE_TAG` format, no `latest`)
Last updated: 2026-10-15

## 1. Goal

A pushed tag `vX.Y.Z` produces the image
`ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z` in GitHub Container Registry and a GitHub release
`vX.Y.Z`. The deploy repository then sets `IMAGE_TAG=X.Y.Z` for both application images.

The backend side is complete (Phase 13): its tag `vX.Y.Z` pushes the backend image and attaches the
`openapi.json` of that image, with `info.version` equal to `X.Y.Z`, to its GitHub release. The
frontend copies that file into its snapshot (`npm run api:sync -- openapi.json`) before tagging.

## 2. Decisions (2026-10-15)

1. **Same rules as the backend.** Only `vX.Y.Z` (strict semver, no pre-release suffix) releases;
   the image tag is `X.Y.Z` without the `v`, because the update script accepts only
   `^\d+\.\d+\.\d+$`. Any other `v*` tag fails the workflow with a message. No `latest`, no moving
   tags. The tagged commit must be on `main`. An image tag that already exists in the registry is
   never overwritten; a fix gets a new patch version.
2. **The contract must match the tag.** The workflow fails unless `info.version` of the committed
   `api/openapi.json` equals `X.Y.Z`. A snapshot taken from a local backend checkout says `dev`,
   so a release always ships the specification of the backend release with the same number
   (design §6.4, §9.2: one version number for the whole system).
3. **The release runs the full CI first.** `ci.yml` becomes reusable (`workflow_call`);
   `release.yml` calls it and builds only when lint, format, typecheck, tests, build, audit, and
   the Docker smoke test pass. No duplicated job definitions.
4. **The image carries its version as OCI labels.** The Dockerfile takes `VERSION` (default
   `dev`), `REVISION`, and `CREATED` and sets `org.opencontainers.image.source` (links the private
   package to this repository, so its access follows the repository), `version`, `revision`,
   `created`, and `title`. `docker inspect` answers which release runs. The panel itself does not
   show a version in this phase.
5. **The released image is smoke tested before the push**, like the CI image: it must serve `/`
   on port 8080.
6. **Platform: `linux/amd64` only**, plain `docker build` (BuildKit), no build attestations, as in
   the backend.
7. **No new actions.** Registry login is `docker login` with the workflow's `GITHUB_TOKEN` through
   stdin; the release is created with the runner's `gh` CLI, with generated notes. Permissions are
   per job: `packages: write` to push, `contents: write` for the release, everything else
   `contents: read`. The action versions already used by `ci.yml` are kept.
8. **The Node version is checked.** CI fails when the `node:` tag of the Dockerfile's build stage
   differs from `.nvmrc` (it was only a comment so far).
9. **`api:sync` keeps taking a path.** Downloading the backend release asset is a manual step
   (`gh release download vX.Y.Z --repo AstRonin/radio-atlantida-backend --pattern openapi.json`):
   the backend repository is private and the frontend holds no token for it.

## 3. Files

| File                            | Change                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/release.yml` | New: check tag, branch, and snapshot version → CI (reusable) → build, check image tag is free, smoke test, push → GitHub release |
| `.github/workflows/ci.yml`      | `workflow_call` trigger; Node version check; the smoke test loop passes shellcheck                                              |
| `docker/Dockerfile`             | `ARG VERSION`, `REVISION`, `CREATED`; OCI labels; `nginx.conf` copied with mode 644, so a local file mode never breaks the image |
| `README.md`, `CLAUDE.md`        | Releasing runbook; phase status                                                                                                   |

## 4. Releasing (runbook)

1. The backend release `vX.Y.Z` exists (its image and its `openapi.json`).
2. Download its `openapi.json`, run `npm run api:sync -- openapi.json`, fix what the compiler
   shows, and merge to `main` with CI green. `api/openapi.json` now says `"version": "X.Y.Z"`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `release` workflow pushes `ghcr.io/astronin/radio-atlantida-frontend:X.Y.Z` and creates the
   release `vX.Y.Z`.
5. Deploy: `update.bat X.Y.Z` once both images exist.

A failed release (for example a flaky test) is re-run from the Actions page; the tag is not moved.
If the image was already pushed and only the release step failed, the re-run stops at the
immutability check; create the release by hand (`gh release create vX.Y.Z --generate-notes`) or tag
a new patch.

A frontend-only fix still needs a backend release with the same number, because the two images
share `IMAGE_TAG` (decision 2). Until then the fix waits on `main`.

## 5. Known limits

- The release path runs only on a real tag; the first release is its acceptance test. The workflows
  are checked with `actionlint` (with shellcheck) locally.
- The GHCR package is private; the first push creates it. Its visibility and the read token of the
  production machine are set by hand (deploy plan D1).
- `api:sync` does not download the release asset itself (decision 9).

## 6. Done when

The image built with `--build-arg VERSION=1.2.3` carries the OCI labels and serves the panel
(checked locally); CI passes with the Node version check; `release.yml` passes `actionlint`, refuses
a non-semver tag, a commit not on `main`, and a snapshot whose `info.version` is not the tag, and on
a valid tag pushes the image and publishes the release.

# Track in use on the edit page: frontend plan

Depends on `backend/docs/track-in-use-plan.md`. The backend adds `in_use` (boolean, nullable) to the track detail response `GET /api/tracks/{id}`. Lists keep it null.

## Goal

On the Edit track page, the Replace file button is disabled up front when the track is in use by a clock insert, a one-time insert, or a plan item that has not aired. The page explains why and points to the clock or the plan. The backend refusal (409 `track_in_use`) stays as the safety net.

## Steps

1. Sync the snapshot: `npm run api:sync` after the backend change is merged or its `api/openapi.json` is regenerated. Check that `Track` has `in_use` (nullable boolean) with its description.
2. `track-edit.component.ts`: the Replace file button is disabled when `dirty() || media.run.running() || mediaOperationRunning() || track.in_use === true`. Keep the other conditions as they are.
3. Show a hint next to the button when `in_use` is true: a new i18n key under `library.replaceFile.*` (for example "The track is used by a clock or the plan. Remove it from there to replace the file."). No hard-coded strings. Use the existing hint pattern of the reviewed-mark hint.
4. Help: `src/assets/help/en/library.json`, the Replace file entry, one sentence about the disabled state.
5. Tests:
   - the button is disabled when the loaded track has `in_use: true`, and the hint is shown;
   - enabled when `in_use: false` and the other conditions allow it;
   - enabled when `in_use` is null (no information) and the other conditions allow it;
   - the existing 409 test still passes (the refusal is still shown when the flag was wrong).
6. Run `npm run typecheck`, `npm run lint`, `npx ng test --watch=false --include` for the library and shared specs, `npm test`, `npm run build`. Report exit codes. `format:check` may fail on `import.spec.ts` and `.claude/agents/frontend.md`, which are not ours; list them and do not fix them.

## Constraints

- Generated types only (`ApiSchema<'Track'>`). Do not hand-write the field.
- No commit, push, branch, or change of git state. Do not edit files outside this change, and do not touch `import.spec.ts`.
- Do not change the replace dialog's chooser, the 409 handling, or the media busy state.

## Done when

- The button is disabled and explained when the track is in a clock insert or the plan.
- The 409 path still shows the refusal.
- All checks above pass, with exit codes reported.

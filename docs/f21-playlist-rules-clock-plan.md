# F21 Plan — Playlist Placement Rules, Clock Inserts, Separation in Play Rules (radio-atlantida-frontend)

Status: Approved by the operator (2026-10-17), open questions answered (§9). Backend contract: backend `docs/phase-23-plan.md` (approved). Needs backend phase 23 (`docs/phase-23-plan.md`) and changes to `docs/base.md` and `docs/tech-design.md` in both repositories.
Based on: `docs/base.md`, `docs/tech-design.md` (§4, §6.0, §6.2, §7, §7.2, §7.3), `docs/f6-clocks-grid-plan.md`, `docs/f7-rotation-views-plan.md`, `docs/f9-outages-missed-plan.md`
Last updated: 2026-10-17

## 1. Goal

Today a clock is a list of elements, and **one element is one track** with a nominal duration and a tolerance. A music hour needs about 17 hand-made elements, and a playlist of 5–7 minute tracks does not fit an element of 3:30 ± 30 s at all. The operator finds this tedious and fragile.

The operator's model (2026-10-17):

1. **A clock is a set of playlists plus timed inserts.** The operator adds, for example, "Music" and "Jingles" to the clock. The system takes tracks from both and lays out the hour by itself.
2. **Placement rules live on the playlist.** "Jingles": "2 per clock, spread among the music" (or "only at the start", "only at the end", "at the start and at the end", "in the middle"). "Music": fills the rest of the hour. A clock may override the rule of a playlist for that clock.
3. **No nominal duration and no tolerance** on clock content. Tracks of any length are used.
4. **Timed inserts**: a track (or a track from a playlist) at a set time `mm:ss` with a start tolerance (default ±1 min). Defined in the clock template (repeats every hour of that clock) or added once to the plan of a single hour (for example, today's news at 30:00 between two "pre-news" jingles at 29:40 and 30:xx). The hour is rebuilt around the inserts.
5. **Separation rules go into play rules** (operator, 2026-10-17). How often a track or an artist may repeat is a play rule attached to the playlist, like the other limits; the Separation rules page is removed.

## 2. Decisions

Operator, 2026-10-17:

1. **Rules on the playlist, overridable in the clock.** The playlist holds the default rule; a clock that uses the playlist may set its own rule for it.
2. **The last track before an insert or the end of the hour** is chosen by best fit to the remaining time; when no track fits the insert's window, the track is cut with the existing fade-out (overflow rule, `liquidsoap.fade_out_ms`, default 2.5 s).
3. **Inserts are separate items, one per track**, with seconds (`29:40`). A news block is two or three inserts, not one block object.
4. **One-time inserts survive every rebuild** of their hour (a grid change, a clock change, a rule change). Music and rule tracks are chosen again around them.
5. **No manual reordering of planned music in this phase.** The operator edits the clock template and the one-time inserts; the system lays out the rest.

6. **Filler is removed completely**, together with the element model. Clock elements, nominal durations, tolerances, filler modes, the filler pool, the filler dialog, and filler reminders are removed. With fill playlists a clock cannot be "short" by design; an hour whose fill playlists are all blocked uses the existing emergency steps (§7) and warns.
7. **`middle` means a track that starts at about 30:00, ±5 minutes**: at the track boundary nearest 30:00 inside 25:00–35:00.
8. **Existing clocks are deleted**, not converted: the station is in development. The migration removes the clocks, their grid slots, and the planned hours.
9. **Shares between fill playlists**: each fill playlist of a clock may have a weight. With weights, the next fill track is taken from a playlist chosen by weight ("New releases" 30, "Gold" 70: three tracks in ten from "New releases"). Either every fill playlist of the clock has a weight or none has; without weights, every fill playlist has the same chance (a playlist is drawn at random, then a track from it), so a small playlist plays as often as a large one.

Proposed in this plan:

10. **Separation rules are removed; play rules take their place** (backend decisions 10–13). A play rule gains an artist interval next to the track interval. The migration creates "Music rotation" from the old separation values and attaches it to the music playlists. Intervals are capped at the play log retention. A fill playlist without a minimum interval gets a warning on the clock save.
11. **Play rules limit, placement rules demand.** The placement rule says where and how many; the play rule says when and how often a track may repeat.

## 3. The model

### 3.1 Placement rule of a playlist

| Rule | Meaning | Count |
|------|---------|-------|
| `fill` (default) | Fills all time not taken by inserts and other rules | — |
| `spread` | N tracks spread over the hour among the fill tracks | 1–12 |
| `start` | The first track of the hour | 1 |
| `end` | The last track of the hour, ending at 60:00 | 1 |
| `start_end` | One track at the start, one at the end | 2 |
| `middle` | One track starting at the track boundary nearest to 30:00, within 25:00–35:00 | 1 |

- Stored on the playlist as `clock_rule` and `clock_count` (count only for `spread`).
- A clock lists its playlists; each row may override the rule and the count.
- **Weights of `fill` playlists** (decision 9) are set on the clock's playlist rows only (`fill_weight`, 1–100, a relative share; the panel shows each row's share of the sum). All fill rows have a weight, or none. With weights, a playlist is drawn by weight for every fill track, then a track from it; when that playlist has no allowed track, the draw is repeated among the others by their weights. Without weights, every fill playlist has weight 1 (operator, 2026-10-17): the playlist is drawn first, so a small playlist plays as often as a large one.
- A clock needs at least one `fill` playlist.
- `spread` places the N tracks in N equal parts of the free time, each at a random track boundary inside its part, never next to another rule track or an insert.

### 3.2 Inserts

- **Template insert** (`clock_inserts`): `offset_ms` (0 to 3 599 000, whole seconds), `tolerance_ms` (default 60 000), and a source: one track **or** one playlist (a track is chosen from it by play rules).
- **One-time insert** (`hour_inserts`, already used for rescheduled missed items): gains `offset_ms` with seconds (replacing `fixed_minute`) and stays one track. Only for hours that have not started.
- **Chains:** inserts are placed in time order. An insert starts at its target, or right after the previous insert when that one ends later, as long as this is inside its tolerance window. So 29:40 jingle (20 s) → 30:00 news → jingle play back to back without music between them.
- **Gaps:** music goes into a gap between inserts only when the gap is at least `rotation.min_filler_gap_ms` (default 10 s); a smaller gap is closed by starting the next insert earlier within its tolerance.
- An insert that cannot start inside its window (the previous chain runs past it) is a save error for a template insert and a 422 for a one-time insert, with the field and the conflicting insert named.

### 3.3 Building an hour (backend)

1. Place template and one-time inserts (§3.2). They split the hour into free gaps.
2. Reserve the rule slots: `start` at the first free moment of the hour, `end` ending at 60:00, `middle` starting within 25:00–35:00 at the boundary nearest 30:00 (skipped with a warning when inserts cover that window), `spread` positions (§3.1).
3. Fill each gap with tracks from the `fill` playlists (by weight, §3.1); before a hard point (an insert window, an `end` track, 60:00) the last track is chosen by best fit to the window, else cut with fade (decision 2).
4. Every candidate passes the play rules of the track and its playlists (track and artist intervals included). A rule slot with no allowed track is skipped with a warning (`track_plan.warning`); a gap with no allowed fill track uses the emergency steps (§7) and warns.
5. Hours that have started are never rebuilt (unchanged).

### 3.4 Dry check on save

Saving a clock builds a sample hour (as the current dry check does) and returns: the sample layout (start, length, track, source: fill / rule / insert), errors per field (no `fill` playlist, an insert outside the hour, insert windows that cannot be chained), and warnings (an empty playlist, a `spread` count no track can satisfy because of play rules). The panel shows them; it never recomputes the layout.

## 4. Backend contract (backend `docs/phase-23-plan.md` §3.6)

The panel cannot start §5.2–§5.5 before this is in `api/openapi.json`. Summary of what the panel uses:

### 4.1 Playlists

- `Playlist` gains `clock_rule` (`fill`, `spread`, `start`, `end`, `start_end`, `middle`; default `fill`) and `clock_count` (1–12, only for `spread`). Field codes `clock_count_required`, `clock_count_not_allowed`.
- `PUT /api/playlists/{id}` returns `build_operation_id` when the rule changed and clocks use the playlist; the page follows it.
- A playlist used by a clock (as a clock playlist or an insert source) cannot be deleted; the refusal names the clocks in `used_by`.

### 4.2 Clocks

- `GET /api/clocks`: `id`, `name`, `playlist_count`, `insert_count`, `updated_at`; no `status`.
- `GET /api/clocks/{id}`: `playlists[]` (`playlist_id`, `position`, `clock_rule?`, `clock_count?`, `fill_weight?`, read-only `effective_rule`, `effective_count`), `inserts[]` (`id`, `offset_ms`, `tolerance_ms`, `track_id?`, `playlist_id?`).
- `POST /api/clocks`, `PUT /api/clocks/{id}` with `name`, `playlists[]`, `inserts[]` → `ClockSaveResult`: `clock`, `sample` (`hour_start_utc`, `items[]`: `offset_ms`, `length_ms`, `track_id`, `title`, `artist`, `source`, `playlist_id?`, `insert_index?`, `truncated`), `warnings[]` (`code`, `message`, `playlist_index?`, `insert_index?`, `hours?`), `build_operation_id?`.
- Field errors: `playlists`, `playlists[i].clock_count`, `playlists[i].fill_weight`, `inserts[i].offset_ms`, `inserts[i].tolerance_ms`, `inserts[i].track_id`; codes `fill_playlist_required`, `fill_weights_partial`, `fill_weight_not_allowed`, `insert_offset_taken`, `insert_source_required`.
- Warning codes (dry check and sample): `playlist_no_tracks`, `fill_few_tracks`, `rule_blocked_by_play_rules`, `insert_skipped`, `rule_slot_skipped`, `fill_general_pool`, `fill_emergency`, `gap_unfilled`.
- Removed: `elements`, `status`, `default_filler_*`, `/save-with-filler`, `/save-incomplete`, `/filler-pool`, `/api/filler-requests*`, `filler_request.created`, the filler settings.

### 4.3 One-time inserts

- `GET /api/track-plan` hours gain `inserts[]` (`id`, `placement`, `offset_ms?`, `tolerance_ms`, `track_id`, `missed_id?`); items gain `insert_id?`, `hour_insert_id?` and the `source` values `fill`, `rule`, `insert`, `hour_insert`, `reschedule`, `general`.
- `POST /api/track-plan/inserts` (`hour_start_utc`, `offset_ms`, `tolerance_ms?`, `track_id`) and `DELETE /api/track-plan/inserts/{id}` → `accepted` with an operation ID of kind `hour_insert` (`hour_insert.completed` / `.failed`). Refusals: 422 on `hour_start_utc` (`hour_started`, …), `offset_ms`, `track_id`; 404 `hour_insert_not_found`; 409 `hour_started`. A track that cannot be placed fails the operation (`insert_does_not_fit`, `insert_blocked`), which already raises the error popup.
- `POST /api/missed-items/{id}/reschedule` takes `offset_ms` instead of `fixed_minute`.
- `track_plan.warning` codes: those of §4.2 plus `insert_replaced`, `hour_insert_dropped`, `reschedule_dropped`.

### 4.4 Play rules

- `PlayRule` gains `artist_min_interval_minutes` (≥ 1); both intervals are at most `retention.play_log_days` days (field code `interval_beyond_retention`, also on the retention setting when it is lowered below an interval).
- `/api/separation-rules*` is deleted; `fill_no_interval_rule` joins the clock warnings.

### 4.5 Migration (decision 8)

The station is in development, so existing clocks are not converted. Backend migration `0013` deletes all clocks, grid slots, the plan, one-time inserts, and the filler data (rescheduled missed items become open again; play history keeps its rows). It is applied with `make migrate` in the backend; the operator rebuilds clocks and the grid afterwards.

## 5. Work (frontend)

### 5.1 Shared inputs

- `app-offset-input` in `shared/forms`: `mm:ss` within the hour (0:00 to 59:59), stored as ms; keyboard steps of 1 s and 1 min. Reuse `app-duration-input` if a seconds-only mode fits.
- `app-clock-rule-input` in `shared/forms`: rule select plus a count field shown only for `spread`, with "Inherited from the playlist: …" when used as an override.

### 5.2 Playlist page

- A section "In clocks" on `playlist-edit.component.ts`: rule and count (§4.1), with a hint per rule. Validators mirror §4.1; server errors with `applyServerErrors()`.
- The playlists list shows the rule as a badge ("Fill", "2 × spread", "Start").

### 5.3 Clock editor (rewrite)

`clock-edit.component.ts` keeps the page shell (header, name, `PendingChanges`, Save); the content becomes:

- **Playlists:** add with `app-playlist-picker`; each row shows the playlist, its type, track count, the inherited rule, and an "Override" toggle that opens `app-clock-rule-input`; remove. Fill rows have an optional "Weight" field and show their share ("30 %") when weights are set. Form errors: no row is `fill`; some fill rows have a weight and others not.
- **Inserts:** a list sorted by time; each row: `app-offset-input`, tolerance (s, default 60), source "Track" (`app-track-picker`, `app-play-button`) or "Playlist" (`app-playlist-select`); add, remove. Field errors from `inserts[i].*`.
- **Sample hour** after a save: the backend's `sample[]` as a timeline list (time, length, title, source badge), inserts highlighted; warnings above it. Shown, never recomputed. A sample longer than the page uses `@defer` if heavy.
- Removed: `clock-element.component.ts`, `clock-filler-pool.component.ts`, `clock-layout.component.ts` (replaced by the sample list), the filler parts of `clock-form.ts`.

### 5.4 Track plan: one-time inserts

- Each future hour in `track-plan-hour.component.ts` gets "Add insert": a dialog with `app-offset-input`, tolerance, `app-track-picker` (filter defaults to playlists of type `news`), preview button. Sends `POST /api/track-plan/inserts`, follows the rebuild with `followOperation()` and `app-operation-status`, reloads the hour.
- Inserts are marked in the hour's list (icon and "Insert" label); a one-time insert has "Remove" (`ConfirmService`), sending `DELETE`.
- Hours that have started show no actions (the backend still decides: `hour_started`).
- Missed-item reschedule (`features/missed-items`) uses `app-offset-input` for a fixed placement.

### 5.5 Removing filler

- Delete `shared/ui/filler-dialog.*`, `core/rotation/filler-reminders.service.ts`, `features/filler-reminders`, its route and navigation entry, the pending-reminder mark in the header, the `filler_request.*` realtime handling, the `filler` settings group, and their i18n keys and help files.
- `shared/forms` filler-mode input is deleted.
- Settings: `rotation.min_filler_gap_ms` stays (renamed by the backend if it decides so); `filler.*` settings go.

### 5.6 Play rules instead of separation

- Delete `features/separation-rules`, its route and navigation entry, its help file, and its i18n keys.
- The play rule form (`play-rule-form.ts`, `play-rule-edit.component.ts`) gets "Artist interval"; both intervals are entered as hours and minutes (new `app-interval-input` in `shared/forms`, stored as minutes), so 72 h is easy to set. Validators mirror §4.4; `interval_beyond_retention` lands on its field.
- The play rules list shows both intervals ("Track 72 h · Artist 2 h").
- The playlist page shows the placement rule and the attached play rules together (the play rule picker is already there); the settings page shows `interval_beyond_retention` on `retention.play_log_days`.

### 5.7 Texts and help

- `src/assets/i18n/en.json`: `clocks.playlists.*`, `clocks.inserts.*`, `clocks.sample.*`, `playlists.clockRule.*`, `trackPlan.inserts.*`, the new error codes (§4).
- Help: rewrite `clocks.json` (playlists, rules, inserts, sample hour, mistakes such as "no fill playlist" and "inserts too close"); add the rule section to `playlists.json`; add one-time inserts to `track-plan.json`; update `play-rules.json` ("a play rule limits, a placement rule demands", the artist interval, the "Music rotation" example, separation folded in); delete `separation-rules.json`.
- `CLAUDE.md`: project context (Clocks, Filler), the Shared UI rule (`FillerDialogService` removed), F21 in the phase list.
- `docs/base.md` and `docs/tech-design.md`: synced from the backend after the backend phase updates them (Appendix A is the proposed requirement text).

## 6. Files

| File | Change |
|------|--------|
| `api/openapi.json` | `npm run api:sync` after backend phase 23 |
| `src/app/shared/forms/offset-input.component.ts` | new: `mm:ss` in the hour |
| `src/app/shared/forms/clock-rule-input.component.ts` | new: rule and count |
| `src/app/features/playlists/playlist-edit.component.ts`, `playlists-page.component.ts` | rule section, badge |
| `src/app/features/clocks/*` | editor rewrite (§5.3) |
| `src/app/features/track-plan/*` | add and remove one-time inserts |
| `src/app/features/missed-items/*` | offset with seconds |
| `src/app/shared/ui/filler-dialog.*`, `src/app/core/rotation/filler-reminders.service.ts`, `src/app/features/filler-reminders/*` | deleted |
| `src/app/app.routes.ts`, `core/shell/*` | filler reminders route and header mark removed |
| `src/app/features/settings/*` | filler group removed; retention field error |
| `src/app/features/separation-rules/*` | deleted |
| `src/app/features/play-rules/*` | artist interval, intervals in hours and minutes |
| `src/app/shared/forms/interval-input.component.ts` | new: hours and minutes, stored as minutes |
| `src/assets/i18n/en.json`, `src/assets/help/en/*.json` | §5.7 |
| `CLAUDE.md`, `docs/base.md`, `docs/tech-design.md` | §5.7 |

## 7. Tests

- **Inputs:** `app-offset-input` parses and formats `29:40`, refuses `60:00` and `5:7x`, keyboard steps; `app-clock-rule-input` shows the count only for `spread` and the inherited rule in override mode.
- **Playlist page:** rule saved with the playlist; 422 `clock_count_required` on the count field.
- **Clock editor (HttpTestingController):** body with `playlists[]` and `inserts[]` matches the spec; form invalid without a `fill` row; insert source track xor playlist; `inserts[1].offset_ms` server error lands on the right row; sample and warnings shown from the response; `build_operation_id` followed; unsaved-changes guard.
- **Track plan:** add insert sends the request and follows the operation; remove asks for confirmation; started hours show no actions; `insert_window_conflict` shown on the time field.
- **Play rules:** artist interval sent and shown; `app-interval-input` turns 72 h into 4 320 minutes and back; `interval_beyond_retention` on the right field.
- **Removal:** no route or nav item for separation rules; no route, nav item, or header mark for filler reminders; the shell and realtime tests pass without `filler_request.*`.
- Help content test passes with the rewritten files.

## 8. Order of work

1. Operator approves this plan and answers §9.
2. Requirements and design: Appendix A into `docs/base.md`, tech-design §4, §6.0, §6.2, §7, §7.2, §7.3 in the backend repository; backend `docs/phase-23-plan.md` (schema, migration §4.4, builder §3.3, API §4).
3. §5.1 inputs (no backend dependency).
4. Backend phase 23, `make openapi`, `make migrate` (deletes the existing clocks and grid, §4.4); `npm run api:sync`.
5. §5.5 removal together with the sync (the compiler shows every use), then §5.2, §5.3, §5.4, §5.6, §5.7.
6. Release backend and frontend of the same version (F12).

## 9. Answers of the operator (2026-10-17)

1. Remove filler completely: yes (decision 6).
2. `middle`: a track starts at about 30:00, ±5 minutes (decision 7).
3. Existing clocks: delete them, the station is in development (decision 8).
4. Several `fill` playlists: a share per playlist; empty for all means every playlist has the same chance, drawn first, then a track from it (decision 9).

## 10. Done when

- The operator builds an hour from "Music" (fill) and "Jingles" (2 × spread) with no elements; with "New releases" 30 and "Gold" 70 as fill weights, about three music tracks in ten come from "New releases"; the plan shows a full hour with two jingles apart from each other, and 6-minute tracks are used.
- A clock with inserts at 29:40 (jingle), 30:00 (news playlist), and a jingle after it plays them back to back; the music before them ends inside the window or fades out.
- After the migration the music playlists carry "Music rotation" (the old separation values); the Separation rules page is gone; a jingle rule "20 minutes apart, 2 per hour" lets jingles repeat within a day.
- The operator adds today's news to 18:30:00 in the track plan; the hour is rebuilt around it; a later grid change keeps the insert.
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 11. Out of scope

- Manual reordering of planned music (decision 5).
- Placement rules on single tracks (the operator chose playlists).
- Converting existing clocks (decision 8).
- Inserts of several tracks as one block object (decision 3).

## Appendix A. Proposed requirement text (`docs/base.md`, "Clock Rules & Rotation")

Replaces the bullets from "A clock element refers to one or more playlists" through "Filling a short clock" and "Validation on save"; the overflow, hour-boundary, and grid-change bullets stay; "Artist/Track Separation" is folded into "Play Rules" (last bullet below).

* A clock is a set of playlists and timed inserts. The system lays out the hour from them by itself; the operator does not list single tracks.
* Every playlist has a placement rule for clocks: fill (fills the time left; the default), spread N tracks over the hour, at the start, at the end, at the start and the end, or in the middle (a track starting at about 30:00, ±5 minutes). A clock may override the rule of a playlist for that clock. A clock needs at least one fill playlist.
* When a clock has several fill playlists, the operator may give each a share (weight); the music is then taken from them in that proportion. Either all fill playlists of a clock have a share or none; without shares every fill playlist has the same chance.
* There is no filler: the fill playlists fill the hour. If no fill track is allowed by the rules, the emergency steps apply and the operator is warned.
* Tracks of any length are used. Audio is never time-stretched. The last track before an insert or the end of the hour is the one that fits the remaining time best; if none fits, it is cut with a short fade-out.
* A timed insert plays a track, or a track from a playlist, at a set time of the hour with seconds (for example, 29:40) and a start tolerance (default ±1 minute). Inserts close together play back to back without music between them.
* Inserts are set in the clock template (every hour of that clock) or added once to a single planned hour that has not started (for example, today's news). A one-time insert stays when the hour is rebuilt; the clock template is not changed.
* Saving a clock builds a sample hour and shows it with its warnings (an empty playlist, a rule no track can satisfy, inserts that cannot be placed). Problems are shown immediately, not at air time.
* Play rules decide which track may play in every slot. A play rule may also set a minimum interval between tracks of the same artist; separation is a play rule ("Music rotation": a track at most once per 72 hours) attached to the music playlists. A slot with no allowed track is skipped and the operator is warned.

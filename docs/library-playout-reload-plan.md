# Library Reload on Playout Events Plan (radio-atlantida-frontend)

Status: Approved
Based on: `docs/f20-track-cue-editor-plan.md` (usage marks), `docs/f18-library-pagination-sort-plan.md` (decision 8), backend `docs/phase-17-plan.md`, `docs/phase-22-plan.md`
Last updated: 2026-11-10

## 1. Goal

The track table on the Library page jumps by 4 px at every track change. The page reloads about 1 s after `playout.now_playing` and `playout.track_ended`, and each reload inserts the in-flow `mat-progress-bar` above the table for 40-60 ms. With 4-second emergency tracks on air, this happens about every 4 s. Every reload also rebuilds all rows, because the table has no `trackBy`, and refetches the stats.

The reload exists so that the usage marks follow the air (F20). It is much broader than that needs:

| Library data | Planned track | Emergency track |
|---|---|---|
| On air mark (`playout_state: on_air`) | changes | changes |
| Queued mark | changes | no change |
| In plan (`next_planned_at`) | changes | no change |
| Other columns | no change | no change |
| Stats | no change, except that the `in_plan` filter changes which tracks are counted | no change |

This task keeps the marks following the air, removes the reload where no server data changed, and stops the table from moving when a reload does happen. No backend change is needed.

## 2. Decisions (2026-11-10)

1. **Reserve the progress bar's space.** The bar goes inside a fixed `height: 4px` slot above the table, and the slot is always rendered. Do not use `position: absolute` on the bar: tested, it widens the scrollable content (`scrollWidth` 1040 → 1064) and risks a horizontal scrollbar flash.
2. **Keep rows between reloads.** The table gets `[trackBy]` by track ID, so rows that stay on the page are updated and not recreated. Cells must still show new values when the same ID returns changed data.
3. **The on-air mark is updated locally from the events, with no request.**
   - `playout.now_playing`: clear `on_air` from any row that has it, then set it on the row whose ID is the event's `track_id`, if that row is on the current page.
   - `playout.track_ended`: clear `on_air` only if that row's ID is the event's `track_id`, so a late `track_ended` for the previous track cannot clear the mark of the track that has just started.
   - This applies to every `source`, including emergency.
   - The row keeps its other fields. A row that was both on air and queued may lose the queued mark until the next reload; this is accepted.
4. **Only a planned track start reloads the page.** `playout.now_playing` with `source === 'plan'` joins the existing debounced group. `playout.track_ended` no longer triggers a reload, and neither does `playout.now_playing` of any other source. `docs/tech-design.md` does not list `source` on `playout.now_playing`, but says the plan item is absent for an emergency track. Use `source` if the generated type has it, otherwise the presence of the plan item. If the generated types show a `source` value other than `plan` and `emergency`, stop and report it before deciding how it behaves.
5. **Playout does not refetch the stats unless the filter needs it.** A reload caused only by `playout.now_playing` reads the page alone (`readPage()`). If the `in_plan` filter is active, it uses the full `reload()`. A debounced burst that also contains a plan event (decision 6) uses the full `reload()`.
6. **All other triggers stay as they are:** `import.completed`, `analyse.completed`, `transcode.completed`, `track.analysed`, `track_plan.completed`, `clock_build.completed`, `reschedule.completed`, `missed_items.completed`.

**Known limit.** The queued mark has no event of its own. If a track is queued later than about 1 s after the previous track started, its mark appears at the next reload. No queue event is added in this task.

**Out of scope.** Other list pages that have the same in-flow bar, the width of the table (`min-width` in `src/styles.scss`), and backend events.

## 3. Files

| File | Change |
|------|--------|
| `src/app/features/library/library-page.component.ts` | the bar slot and its style; `trackBy`; local on-air mark updates; the narrowed playout subscription; page-only read for playout |
| `src/app/features/library/library-usage.spec.ts` | update the tests that assert the old behaviour (`reads the page once after a burst of playout and plan events`, and the following test); add the tests below |
| `src/app/features/library/library.spec.ts` | only if an existing test depends on the bar or on recreated rows |

## 4. Tests

- **Emergency track:** `playout.now_playing` with `source: 'emergency'` sends no `GET /api/tracks` and no `GET /api/tracks/stats`, and the on-air mark moves to the matching row.
- **Track not on the page:** the mark is cleared from the previous row and no row gets it.
- **`track_ended`:** sends no request; clears the mark of the matching row; does not clear the mark when the event is for another track.
- **Planned track:** after the debounce, exactly one `GET /api/tracks` and no stats request.
- **Planned track with the `in_plan` filter:** page and stats are both read.
- **Burst of a planned track start and a plan event:** one page read and one stats read.
- **Other triggers:** import, analysis, transcode, and plan events still reload as before.
- **`trackBy`:** a reload that returns the same ID keeps the row's DOM element and shows the new values.
- **Bar slot:** the slot is present with and without `loading()`, and the bar appears only while loading.

## 5. Done when

- `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` pass.
- In a browser with the emergency playlist on air, the table position does not change over 25 s, `GET /api/tracks` is not sent on track changes, and the on-air mark moves between rows.
- With planned tracks, the table position does not change during a reload, and In plan and the marks update at the track start.

# Collapse past empty hours in the grid: frontend plan

## Goal

On the Grid page, an hour row of a week table takes almost no space when it is of no use any more: the hour has ended on every day of that week, and no clock was assigned to it on any of those days. Consecutive such hours merge into one thin row that the operator can expand. Everything else looks as it does now.

## Current state

- `features/grid/grid-page.component.ts` shows one month, split into Monday-to-Sunday weeks (`weeksOf`, lines 642-649). Each week is an `app-grid-week` (`features/grid/grid-week.component.ts`) with 24 hour rows (`HOURS`) and seven day columns.
- The cells come from `GET /api/grid?from=&to=` for the month's first and last day (`rxResource`, grid-page 405-412). The response lists only hours with a clock (`GridHour { date, hour, clock, slot_id, start_utc, weekday }`), so "no clock" means no item for `date|hour`.
- Days of the neighbouring months in the first and last week are dimmed (`.outside`) and never have items, because they are outside the fetched range.
- The page has no "now" in station time: `today = computed(() => stationToday(zone()))` recomputes only when the zone changes. Nothing marks past hours.
- `core/time/local-date.ts` has private `zoneOffsetMs` / `stationMidnightUtc`, but no exported helper for the start of a station hour.

## Decisions

1. **Rule.** In a week table, hour `h` is collapsed when, for all seven dates of the week:
   - the hour has ended: the station-local hour `date h:00 + 1 h` is at or before now;
   - there is no grid item for `date|h`.

   Because all seven days must have ended, a row is collapsed only in weeks that are entirely past, and in the current week only for the hours of Sunday that have ended. A row in a week with a future day is never collapsed, so a "+" button is never hidden.
2. **Neighbouring-month days count with real data.** The grid request covers whole weeks: `from` = Monday of the first week, `to` = Sunday of the last week (at most 42 days, within the 62-day API limit). The cells of those days are still dimmed, and the "+" range (`pickFrom`..`pickTo`) stays limited to the month as today. Without this, a past week at the start of the month would treat the previous month's days as empty and collapse hours that did have clocks.
3. **Selected hours are never collapsed.** An hour in the form's `selectedHours` stays expanded, so its "−" button is always visible.
4. **Display.** A run of consecutive collapsed hours is one row:
   - row header `02:00–05:00` (start of the first hour, end of the last), the cells merged into one `td colspan="7"` with the text "No clocks" (`grid.week.collapsed`), muted colour, height about half of a normal row;
   - the whole row is a button (`aria-expanded="false"`, `aria-label` like "Show hours 02:00–05:00"); a click expands that run into the normal 24-hour rows;
   - an expanded run gets a small "Collapse" button in the header of its first row (`aria-expanded="true"`) to fold it again.
   - The expanded state is local to the `app-grid-week` instance (a `signal<Set<number>>` of the expanded run's first hour). It resets on month change. Nothing is stored in `localStorage`.
5. **"Now" ticks.** A `now` signal in the page, updated once a minute (`interval(60_000)` with `takeUntilDestroyed`, the pattern of `air-window-page.component.ts:110`), from `Date.now()`. It is passed to `app-grid-week` as an input. `today` is derived from the same signal (`stationToday(zone(), now())`), so a page left open past midnight moves to the new date too. Precision of one minute is enough: a row collapses at most a minute late.
6. **Hour end in station time.** Add an exported pure helper to `core/time/local-date.ts`, for example `stationHourStartUtc(date: string, hour: number, zone: string): number` (ms since epoch), built on the existing `zoneOffsetMs`. It must give the right instant on DST change days in zones that have them (the station default `Asia/Yerevan` has none). The end of an hour is the start of the next one (`hour + 1`, or hour 0 of the next date for 23), not `start + 1 h`, so a 23- or 25-hour day is handled. Tests cover a zone with DST (for example `Europe/Berlin`, last Sunday of March and October).

## Steps

1. `core/time/local-date.ts`: `stationHourStartUtc` (and, if needed, a variant of `stationToday` that takes the instant). Unit tests in the existing `local-date` spec.
2. `grid-page.component.ts`:
   - the `now` tick and `today` derived from it;
   - the grid request uses the first week's Monday and the last week's Sunday;
   - pass `now` (and the zone, if the week component needs it) to every `app-grid-week`.
3. `grid-week.component.ts`:
   - input `now`;
   - `collapsedHours = computed(...)`: hours that satisfy decision 1 and are not in `selectedHours`;
   - `rows = computed(...)`: the sequence the template renders, either `{ kind: 'hour', hour }` or `{ kind: 'collapsed', from, to }`, taking the expanded runs into account;
   - template and styles for the collapsed row and the Collapse button, with Material system tokens like the rest of the component; check it with the sticky header (`thead th` only) and in the dark theme.
4. i18n `src/assets/i18n/en.json` (`grid.week.collapsed`, `grid.week.expand`, `grid.week.collapse`, with the hour range as a parameter). Help `src/assets/help/en/grid.json`: one sentence that past hours without clocks are folded and can be opened with a click.
5. Tests in `features/grid/grid.spec.ts` (fake `Date`, as the spec does now):
   - a past week with clocks only in some hours: the empty hours are folded into runs, the hours with clocks are rows;
   - the current week: no row is collapsed while any day of the week is ahead;
   - a past first week of the month whose previous-month day has a clock in an hour: that hour is not collapsed (the request now covers whole weeks; update the expected `from`/`to` in the existing tests);
   - click on a collapsed run expands it; Collapse folds it again; month change resets it;
   - a selected hour is not collapsed;
   - advancing the fake time past the end of an hour (and past midnight) updates the rows and `today`.
6. `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. Check by hand in `npm run dev`: a past month, the current month, a future month, narrow layout, dark theme.

## Out of scope

- Collapsing empty future hours, or empty hours of the current week.
- Remembering the expanded state between visits.
- Backend changes.

## Report

- The files changed and the new helper's signature.
- How the collapsed row looks (a screenshot or a short description) and any deviation from decision 4.
- Test results.

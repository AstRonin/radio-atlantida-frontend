import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { HOURS } from '../../shared/forms/hours-input.component';
import {
  addDays,
  hourLabel,
  localDateAsUtcNoon,
  stationHourStartUtc,
  weekdayName,
  weekdayOf,
} from '../../core/time/local-date';

type GridHour = ApiSchema<'GridHour'>;

export interface GridCell {
  date: string;
  weekday: number;
  hour: number;
}

/** Consecutive folded hours, `from` to `to` both included; `label` is `02:00–05:00`. */
interface HourRun {
  from: number;
  to: number;
  label: string;
}

/** What the table shows: an hour row (the first row of an opened run carries it), or a run. */
type WeekRow =
  | { kind: 'hour'; key: string; hour: number; run: HourRun | null }
  | { kind: 'collapsed'; key: string; run: HourRun };

/**
 * One week of the grid: hours down, station local dates across, the clock of each hour as the
 * backend resolved it. A cell button adds its weekday and hour to the change form; a button in a
 * chosen day's or hour's header removes that weekday or hour, since a change always covers every
 * chosen weekday at every chosen hour and one cell alone cannot be taken out. An hour that has
 * ended on all seven days without a clock on any of them is folded with its neighbours into one
 * thin row, which a click opens; a chosen hour is never folded. Presentational.
 */
@Component({
  selector: 'app-grid-week',
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-scroll">
      <table class="week">
        <caption class="cdk-visually-hidden">
          {{
            'grid.week.caption' | translate
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ 'grid.week.hour' | translate }}</th>
            @for (day of days(); track day.date) {
              <th
                scope="col"
                [class.today]="day.date === today()"
                [class.outside]="!inMonth(day.date)"
              >
                <span class="heading">
                  <span>
                    {{ day.label }}
                    @if (day.date === today()) {
                      <span class="cdk-visually-hidden">{{ 'grid.week.today' | translate }}</span>
                    }
                  </span>
                  @if (weekdaySet().has(day.weekday)) {
                    <button
                      type="button"
                      class="unpick"
                      [attr.aria-label]="
                        'grid.week.unpickWeekday' | translate: { weekday: day.weekdayName }
                      "
                      (click)="unpickWeekday.emit(day.weekday)"
                    >
                      −
                    </button>
                  }
                </span>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            @if (row.kind === 'collapsed') {
              <tr class="collapsed">
                <th scope="row">{{ row.run.label }}</th>
                <td colspan="7">
                  <button
                    type="button"
                    class="expand"
                    aria-expanded="false"
                    [attr.data-run]="row.run.from"
                    [attr.aria-label]="'grid.week.expand' | translate: { range: row.run.label }"
                    (click)="expand(row.run)"
                  >
                    {{ 'grid.week.collapsed' | translate }}
                  </button>
                </td>
              </tr>
            } @else {
              @let hour = row.hour;
              <tr>
                <th scope="row">
                  <span class="heading">
                    {{ hourText(hour) }}
                    @if (row.run; as run) {
                      <button
                        type="button"
                        class="fold"
                        aria-expanded="true"
                        [attr.data-run]="run.from"
                        [attr.aria-label]="'grid.week.collapse' | translate: { range: run.label }"
                        (click)="collapse(run)"
                      >
                        ▴
                      </button>
                    }
                    @if (hourSet().has(hour)) {
                      <button
                        type="button"
                        class="unpick"
                        [attr.aria-label]="
                          'grid.week.unpickHour' | translate: { hour: hourText(hour) }
                        "
                        (click)="unpickHour.emit(hour)"
                      >
                        −
                      </button>
                    }
                  </span>
                </th>
                @for (day of days(); track day.date) {
                  @let entry = cells().get(day.date + '|' + hour);
                  <td
                    [class.outside]="!inMonth(day.date)"
                    [class.selected]="isSelected(day.weekday, hour)"
                  >
                    @if (entry) {
                      <a class="clock" [routerLink]="['/clocks', entry.clock.id]">
                        {{ entry.clock.name }}
                      </a>
                    }
                    @if (canPick(day.date)) {
                      <button
                        type="button"
                        class="pick"
                        [attr.aria-label]="
                          'grid.week.pick' | translate: { day: day.label, hour: hourText(hour) }
                        "
                        (click)="pick.emit({ date: day.date, weekday: day.weekday, hour })"
                      >
                        +
                      </button>
                    }
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    /* A whole week (24 hours) fits on a 1080p screen, so the page scrolls from week to week. */
    .table-scroll {
      --table-max-height: max(calc(100dvh - 8rem), 20rem);
    }

    .week {
      width: 100%;
      min-width: 48rem;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      font: var(--mat-sys-body-small);
    }

    /*
     * Separate borders, because the sticky header loses collapsed ones: each cell draws its end
     * and bottom edge, the header row the top edge, and the first column the start edge.
     */
    th,
    td {
      padding: 0.125rem 0.25rem;
      border: 0 solid var(--mat-sys-outline-variant);
      border-inline-end-width: 1px;
      border-bottom-width: 1px;
      text-align: start;
      vertical-align: middle;
    }

    tr > :first-child {
      border-inline-start-width: 1px;
    }

    thead th {
      border-top-width: 1px;
      font: var(--mat-sys-label-medium);
    }

    tbody th {
      width: 4.5rem;
      font-variant-numeric: tabular-nums;
    }

    .today {
      background: var(--mat-sys-secondary-container);
    }

    td {
      position: relative;
      height: 1.75rem;
    }

    td.selected {
      background: var(--mat-sys-primary-container);
    }

    th.outside,
    td.outside {
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container-low);
    }

    .clock {
      display: block;
      overflow: hidden;
      padding-inline-end: 1.25rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .heading {
      display: flex;
      gap: 0.25rem;
      align-items: center;
      justify-content: space-between;
    }

    .pick,
    .unpick {
      width: 1.25rem;
      height: 1.25rem;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }

    .unpick {
      flex: none;
      color: var(--mat-sys-primary);
      font-weight: bold;
    }

    .pick {
      position: absolute;
      top: 50%;
      inset-inline-end: 0.125rem;
      transform: translateY(-50%);
    }

    .pick:hover,
    .pick:focus-visible,
    .unpick:hover,
    .unpick:focus-visible,
    .fold:hover,
    .fold:focus-visible {
      background: var(--mat-sys-surface-container-high);
    }

    .fold {
      flex: none;
      width: 1.25rem;
      height: 1.25rem;
      margin-inline-start: auto;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }

    /* The button's ::after covers the whole row, so the hour range is clickable too. */
    tr.collapsed {
      position: relative;
    }

    tr.collapsed th,
    tr.collapsed td {
      position: static;
      height: 0.875rem;
      padding-block: 0;
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container-low);
      font: var(--mat-sys-label-small);
    }

    tr.collapsed:hover th,
    tr.collapsed:hover td {
      background: var(--mat-sys-surface-container-high);
    }

    .expand {
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }

    .expand::after {
      position: absolute;
      inset: 0;
      content: '';
    }
  `,
})
export class GridWeekComponent {
  private readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The seven station local dates shown, in order. */
  readonly dates = input.required<readonly string[]>();
  /** The first and last date of the month shown; the other days of the week are dimmed. */
  readonly first = input.required<string>();
  readonly last = input.required<string>();
  /** The dates a cell may be picked on, both included; cells outside them have no "+". */
  readonly pickFrom = input.required<string>();
  readonly pickTo = input.required<string>();
  readonly entries = input.required<readonly GridHour[]>();
  readonly today = input.required<string>();
  /** The current instant (ms since the epoch) and the station zone, to tell which hours ended. */
  readonly now = input.required<number>();
  readonly zone = input.required<string>();
  readonly selectedWeekdays = input<readonly number[]>([]);
  readonly selectedHours = input<readonly number[]>([]);

  readonly pick = output<GridCell>();
  /** A weekday, 1 = Monday, to take out of the change. */
  readonly unpickWeekday = output<number>();
  readonly unpickHour = output<number>();

  protected readonly hourText = hourLabel;

  /** The hours of the opened runs; a new month starts with every run folded. */
  private readonly expanded = linkedSignal<string, ReadonlySet<number>>({
    source: this.first,
    computation: () => new Set(),
  });

  protected readonly days = computed(() => {
    const format = new Intl.DateTimeFormat(this.i18n.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    return this.dates().map((date) => {
      const weekday = weekdayOf(date);
      return {
        date,
        weekday,
        weekdayName: weekdayName(weekday, this.i18n.locale(), 'long'),
        label: format.format(localDateAsUtcNoon(date)),
      };
    });
  });

  protected readonly cells = computed(
    () => new Map(this.entries().map((entry) => [`${entry.date}|${entry.hour}`, entry])),
  );

  protected readonly weekdaySet = computed(() => new Set(this.selectedWeekdays()));
  protected readonly hourSet = computed(() => new Set(this.selectedHours()));

  /**
   * The hours that ended on every day of the week with no clock on any day, unless chosen. An
   * hour ends later on each date of the week than on the one before, so the last date decides.
   */
  protected readonly foldedHours = computed(() => {
    const dates = this.dates();
    const last = dates.at(-1);
    const folded = new Set<number>();
    if (!last) {
      return folded;
    }
    const now = this.now();
    const zone = this.zone();
    const cells = this.cells();
    const chosen = this.hourSet();
    for (const hour of HOURS) {
      const end =
        hour < 23
          ? stationHourStartUtc(last, hour + 1, zone)
          : stationHourStartUtc(addDays(last, 1), 0, zone);
      if (end <= now && !chosen.has(hour) && dates.every((date) => !cells.has(`${date}|${hour}`))) {
        folded.add(hour);
      }
    }
    return folded;
  });

  protected readonly rows = computed<WeekRow[]>(() => {
    const folded = this.foldedHours();
    const expanded = this.expanded();
    const rows: WeekRow[] = [];
    let hour = 0;
    while (hour < HOURS.length) {
      if (!folded.has(hour)) {
        rows.push({ kind: 'hour', key: `h${hour}`, hour, run: null });
        hour++;
        continue;
      }
      let to = hour;
      while (folded.has(to + 1)) {
        to++;
      }
      const run = { from: hour, to, label: `${hourLabel(hour)}–${hourLabel(to + 1)}` };
      // A run stays open when a choice or a new clock splits it, as long as one hour was opened.
      if (HOURS.slice(hour, to + 1).some((item) => expanded.has(item))) {
        for (let item = hour; item <= to; item++) {
          rows.push({ kind: 'hour', key: `h${item}`, hour: item, run: item === hour ? run : null });
        }
      } else {
        rows.push({ kind: 'collapsed', key: `c${hour}`, run });
      }
      hour = to + 1;
    }
    return rows;
  });

  protected expand(run: HourRun): void {
    this.expanded.update((hours) => new Set([...hours, ...this.runHours(run)]));
    this.focusRun(run, 'button.fold');
  }

  protected collapse(run: HourRun): void {
    const hours = new Set(this.runHours(run));
    this.expanded.update((open) => new Set([...open].filter((hour) => !hours.has(hour))));
    this.focusRun(run, 'button.expand');
  }

  private runHours(run: HourRun): number[] {
    return HOURS.slice(run.from, run.to + 1);
  }

  // The clicked button leaves the page, so the focus moves to the one that replaces it.
  private focusRun(run: HourRun, selector: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLButtonElement>(`${selector}[data-run="${run.from}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected isSelected(weekday: number, hour: number): boolean {
    return this.weekdaySet().has(weekday) && this.hourSet().has(hour);
  }

  protected inMonth(date: string): boolean {
    return date >= this.first() && date <= this.last();
  }

  protected canPick(date: string): boolean {
    return date >= this.pickFrom() && date <= this.pickTo();
  }
}

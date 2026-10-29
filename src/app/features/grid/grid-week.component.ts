import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { HOURS } from '../../shared/forms/hours-input.component';
import { hourLabel, localDateAsUtcNoon, weekdayName, weekdayOf } from '../../core/time/local-date';

type GridHour = ApiSchema<'GridHour'>;

export interface GridCell {
  date: string;
  weekday: number;
  hour: number;
}

/**
 * One week of the grid: hours down, station local dates across, the clock of each hour as the
 * backend resolved it. A cell button adds its weekday and hour to the change form; a button in a
 * chosen day's or hour's header removes that weekday or hour, since a change always covers every
 * chosen weekday at every chosen hour and one cell alone cannot be taken out. Presentational.
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
          @for (hour of hours; track hour) {
            <tr>
              <th scope="row">
                <span class="heading">
                  {{ hourText(hour) }}
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
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .week {
      width: 100%;
      min-width: 48rem;
      border-collapse: collapse;
      table-layout: fixed;
      font: var(--mat-sys-body-small);
    }

    th,
    td {
      padding: 0.125rem 0.25rem;
      border: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      vertical-align: middle;
    }

    thead th {
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
    .unpick:focus-visible {
      background: var(--mat-sys-surface-container-high);
    }
  `,
})
export class GridWeekComponent {
  private readonly i18n = inject(I18nService);

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
  readonly selectedWeekdays = input<readonly number[]>([]);
  readonly selectedHours = input<readonly number[]>([]);

  readonly pick = output<GridCell>();
  /** A weekday, 1 = Monday, to take out of the change. */
  readonly unpickWeekday = output<number>();
  readonly unpickHour = output<number>();

  protected readonly hours = HOURS;
  protected readonly hourText = hourLabel;

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

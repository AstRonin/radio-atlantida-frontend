import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { HOURS } from '../../shared/forms/hours-input.component';
import { hourLabel, localDateAsUtcNoon, weekdayOf } from '../../core/time/local-date';

type GridHour = ApiSchema<'GridHour'>;

export interface GridCell {
  date: string;
  weekday: number;
  hour: number;
}

/**
 * One week of the grid: hours down, station local dates across, the clock of each hour as the
 * backend resolved it. A cell button adds its weekday and hour to the change form. Presentational.
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
              <th scope="col" [class.today]="day.date === today()">
                {{ day.label }}
                @if (day.date === today()) {
                  <span class="cdk-visually-hidden">{{ 'grid.week.today' | translate }}</span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (hour of hours; track hour) {
            <tr>
              <th scope="row">{{ hourText(hour) }}</th>
              @for (day of days(); track day.date) {
                @let entry = cells().get(day.date + '|' + hour);
                <td
                  [class.selected]="isSelected(day.weekday, hour)"
                  [class.incomplete]="entry?.clock?.status === 'incomplete'"
                >
                  @if (entry) {
                    <a class="clock" [routerLink]="['/clocks', entry.clock.id]">
                      {{ entry.clock.name }}
                    </a>
                  }
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
      width: 3.5rem;
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

    td.incomplete .clock {
      color: var(--mat-sys-error);
    }

    .clock {
      display: block;
      overflow: hidden;
      padding-inline-end: 1.25rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pick {
      position: absolute;
      top: 50%;
      inset-inline-end: 0.125rem;
      transform: translateY(-50%);
      width: 1.25rem;
      height: 1.25rem;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }

    .pick:hover,
    .pick:focus-visible {
      background: var(--mat-sys-surface-container-high);
    }
  `,
})
export class GridWeekComponent {
  private readonly i18n = inject(I18nService);

  /** The seven station local dates shown, in order. */
  readonly dates = input.required<readonly string[]>();
  readonly entries = input.required<readonly GridHour[]>();
  readonly today = input.required<string>();
  readonly selectedWeekdays = input<readonly number[]>([]);
  readonly selectedHours = input<readonly number[]>([]);

  readonly pick = output<GridCell>();

  protected readonly hours = HOURS;
  protected readonly hourText = hourLabel;

  protected readonly days = computed(() => {
    const format = new Intl.DateTimeFormat(this.i18n.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    return this.dates().map((date) => ({
      date,
      weekday: weekdayOf(date),
      label: format.format(localDateAsUtcNoon(date)),
    }));
  });

  protected readonly cells = computed(
    () => new Map(this.entries().map((entry) => [`${entry.date}|${entry.hour}`, entry])),
  );

  private readonly weekdaySet = computed(() => new Set(this.selectedWeekdays()));
  private readonly hourSet = computed(() => new Set(this.selectedHours()));

  protected isSelected(weekday: number, hour: number): boolean {
    return this.weekdaySet().has(weekday) && this.hourSet().has(hour);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Observable, finalize, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { OperationStatus, OperationsService } from '../../core/operations/operations.service';
import { SettingsService } from '../../core/settings/settings.service';
import {
  addDays,
  hourLabel,
  localDateAsUtcNoon,
  stationToday,
  weekdayName,
} from '../../core/time/local-date';
import { StationTimeService } from '../../core/time/station-time.service';
import { DateInputComponent } from '../../shared/forms/date-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { HoursInputComponent } from '../../shared/forms/hours-input.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { nonEmptyValidator, weekdaysValidator } from '../../shared/forms/validators';
import { WeekdaysInputComponent } from '../../shared/forms/weekdays-input.component';
import { ClockSelectComponent } from '../../shared/pickers/clock-select.component';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { GridCell, GridWeekComponent } from './grid-week.component';

type GridSlot = ApiSchema<'GridSlot'>;
type GridAssignResult = ApiSchema<'GridAssignResult'>;

/** The setting that limits how far ahead `valid_from` may lie (design §4). */
export const GRID_HORIZON_KEY = 'rotation.grid_horizon_days';
export const DEFAULT_GRID_HORIZON_DAYS = 30;
const WEEK_DAYS = 7;

/**
 * The grid (design §4, §7): which clock plays in which station local hour, up to the horizon. The
 * week view shows the hours as the backend resolves them; one form assigns a clock to weekdays and
 * hours for a date range, or clears them. Overlapping slots are replaced by the backend, and the
 * result names them. Each change rebuilds the affected planned hours (`clock_build`).
 */
@Component({
  selector: 'app-grid-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ClockSelectComponent,
    DateInputComponent,
    GridWeekComponent,
    HoursInputComponent,
    PageHeaderComponent,
    WeekdaysInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="grid.title" helpPage="help.grid" />

    <section class="page-section" aria-labelledby="week-heading">
      <div class="week-head">
        <h2 id="week-heading" class="section-title">
          {{
            'grid.week.title' | translate: { from: dateText(dates()[0]), to: dateText(dates()[6]) }
          }}
        </h2>
        <span class="week-nav">
          <button matButton type="button" (click)="shiftWeek(-1)">
            {{ 'grid.week.previous' | translate }}
          </button>
          <button matButton type="button" (click)="weekStart.set(null)">
            {{ 'grid.week.current' | translate }}
          </button>
          <button matButton type="button" (click)="shiftWeek(1)">
            {{ 'grid.week.next' | translate }}
          </button>
        </span>
      </div>
      <p class="muted">{{ 'grid.week.note' | translate: { zone: zone() } }}</p>
      @if (week.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (weekError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="week.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <app-grid-week
        [dates]="dates()"
        [entries]="weekEntries()"
        [today]="today()"
        [selectedWeekdays]="selectedWeekdays()"
        [selectedHours]="selectedHours()"
        (pick)="pick($event)"
        (unpickWeekday)="unpick('weekdays', $event)"
        (unpickHour)="unpick('hours', $event)"
      />
    </section>

    <section class="page-section" aria-labelledby="change-heading">
      <h2 id="change-heading" class="section-title">{{ 'grid.change.title' | translate }}</h2>
      <p class="muted">{{ 'grid.change.note' | translate }}</p>
      <form [formGroup]="form" (ngSubmit)="assign()">
        <app-weekdays-input
          [control]="form.controls.weekdays"
          label="grid.fields.weekdays"
          hintPage="help.grid"
          hintField="weekdays"
        />
        <app-hours-input
          [control]="form.controls.hours"
          label="grid.fields.hours"
          hintPage="help.grid"
          hintField="hours"
        />
        <div class="form-grid">
          <app-clock-select
            [control]="form.controls.clock_id"
            label="grid.fields.clock_id"
            hintPage="help.grid"
            hintField="clock_id"
          />
          <app-date-input
            [control]="form.controls.valid_from"
            label="grid.fields.valid_from"
            [min]="today()"
            [max]="horizonDate()"
            hintPage="help.grid"
            hintField="valid_from"
          />
          <app-date-input
            [control]="form.controls.valid_to"
            label="grid.fields.valid_to"
            [min]="form.controls.valid_from.value"
            hintPage="help.grid"
            hintField="valid_to"
          />
        </div>
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <div class="form-actions">
          <button matButton="filled" type="submit" [disabled]="busy() || !canAssign()">
            {{ 'grid.change.assign' | translate }}
          </button>
          <button matButton type="button" [disabled]="busy() || !canClear()" (click)="clear()">
            {{ 'grid.change.clear' | translate }}
          </button>
          <button
            matButton
            type="button"
            [disabled]="selectedWeekdays().length === 0 && selectedHours().length === 0"
            (click)="resetSelection()"
          >
            {{ 'grid.change.resetSelection' | translate }}
          </button>
        </div>
      </form>

      @if (result(); as change) {
        <div class="result" role="status">
          <p>{{ 'grid.result.created' | translate: { count: change.created.length } }}</p>
          @if (change.replaced.length > 0) {
            <p>{{ 'grid.result.replaced' | translate }}</p>
            <ul>
              @for (entry of change.replaced; track entry.slot.id) {
                <li>
                  {{ describeSlot(entry.slot) }} —
                  {{ 'grid.result.change.' + entry.change | translate }}
                </li>
              }
            </ul>
          }
        </div>
      }
      @if (buildStatus(); as status) {
        <p class="muted" role="status">{{ 'clocks.build.' + status | translate }}</p>
      }
    </section>

    <section class="page-section" aria-labelledby="slots-heading">
      <h2 id="slots-heading" class="section-title">{{ 'grid.slots.title' | translate }}</h2>
      @if (slots.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (slotsError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="slots.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <div class="table-scroll">
        <table class="slots">
          <thead>
            <tr>
              <th scope="col">{{ 'grid.slots.weekday' | translate }}</th>
              <th scope="col">{{ 'grid.slots.hour' | translate }}</th>
              <th scope="col">{{ 'grid.fields.clock_id' | translate }}</th>
              <th scope="col">{{ 'grid.fields.valid_from' | translate }}</th>
              <th scope="col">{{ 'grid.fields.valid_to' | translate }}</th>
              <th scope="col">
                <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (slot of slotRows(); track slot.id) {
              <tr>
                <td>{{ dayName(slot.weekday) }}</td>
                <td>{{ hourText(slot.hour) }}</td>
                <td>
                  <a [routerLink]="['/clocks', slot.clock.id]">{{ slot.clock.name }}</a>
                  @if (slot.clock.status === 'incomplete') {
                    <span class="badge warn">{{ 'clocks.status.incomplete' | translate }}</span>
                  }
                </td>
                <td>{{ dateText(slot.valid_from) }}</td>
                <td>
                  {{ slot.valid_to ? dateText(slot.valid_to) : ('grid.slots.openEnd' | translate) }}
                </td>
                <td class="cell-actions">
                  <button matButton type="button" (click)="removeSlot(slot)">
                    {{ 'common.delete' | translate }}
                  </button>
                </td>
              </tr>
            } @empty {
              @if (!slots.isLoading() && !slotsError()) {
                <tr>
                  <td class="muted" colspan="6">{{ 'common.empty' | translate }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .section-title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .week-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      justify-content: space-between;
    }

    .week-nav {
      display: flex;
      flex-wrap: wrap;
    }

    .result {
      margin-top: 1rem;
    }

    .slots {
      width: 100%;
      border-collapse: collapse;
    }

    .slots th,
    .slots td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }
  `,
})
export default class GridPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly confirm = inject(ConfirmService);
  private readonly operations = inject(OperationsService);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly zone = inject(StationTimeService).zone;
  protected readonly today = computed(() => stationToday(this.zone()));
  protected readonly horizonDate = computed(() => {
    const value: unknown = this.settings.get(GRID_HORIZON_KEY)?.value;
    const days = typeof value === 'number' ? value : DEFAULT_GRID_HORIZON_DAYS;
    return addDays(this.today(), days);
  });

  /** First date of the week shown; null follows today. */
  protected readonly weekStart = signal<string | null>(null);
  protected readonly dates = computed(() => {
    const start = this.weekStart() ?? this.today();
    return Array.from({ length: WEEK_DAYS }, (_, day) => addDays(start, day));
  });

  protected readonly form = new FormGroup({
    clock_id: new FormControl<number | null>(null, Validators.required),
    weekdays: new FormControl<number[] | null>([], [nonEmptyValidator, weekdaysValidator]),
    hours: new FormControl<number[] | null>([], nonEmptyValidator),
    valid_from: new FormControl<string | null>(null, Validators.required),
    valid_to: new FormControl<string | null>(null),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<GridAssignResult | null>(null);
  protected readonly buildStatus = signal<OperationStatus | null>(null);

  private readonly version = controlVersion(signal(this.form));
  protected readonly selectedWeekdays = computed(() => {
    this.version();
    return this.form.controls.weekdays.value ?? [];
  });
  protected readonly selectedHours = computed(() => {
    this.version();
    return this.form.controls.hours.value ?? [];
  });
  protected readonly canAssign = computed(() => {
    this.version();
    return this.form.valid;
  });
  protected readonly canClear = computed(() => {
    this.version();
    const { weekdays, hours, valid_from } = this.form.controls;
    return weekdays.valid && hours.valid && valid_from.valid;
  });

  protected readonly week = rxResource({
    params: () => ({ from: this.dates()[0], to: this.dates()[WEEK_DAYS - 1] }),
    stream: ({ params }) =>
      this.api.get('/api/grid', { query: params }).pipe(map((schedule) => schedule.items)),
  });
  protected readonly weekEntries = computed(() => (this.week.hasValue() ? this.week.value() : []));
  protected readonly weekError = computed(() =>
    this.week.status() === 'error' ? errorMessage(this.week.error(), this.i18n) : null,
  );

  protected readonly slots = rxResource({
    params: () => ({ from: this.today() }),
    stream: ({ params }) =>
      this.api.get('/api/grid/slots', { query: params }).pipe(map((list) => list.items)),
  });
  protected readonly slotRows = computed(() => (this.slots.hasValue() ? this.slots.value() : []));
  protected readonly slotsError = computed(() =>
    this.slots.status() === 'error' ? errorMessage(this.slots.error(), this.i18n) : null,
  );

  protected readonly hourText = hourLabel;

  protected shiftWeek(by: -1 | 1): void {
    this.weekStart.set(addDays(this.dates()[0], by * WEEK_DAYS));
  }

  /** Adds the cell's weekday and hour to the form; the first pick also sets the start date. */
  protected pick(cell: GridCell): void {
    const { weekdays, hours, valid_from } = this.form.controls;
    weekdays.setValue(addSorted(weekdays.value, cell.weekday));
    hours.setValue(addSorted(hours.value, cell.hour));
    if (!valid_from.value) {
      valid_from.setValue(cell.date < this.today() ? this.today() : cell.date);
    }
    this.form.markAsDirty();
  }

  /** Takes a weekday or an hour out of the change, with every cell of its column or row. */
  protected unpick(field: 'weekdays' | 'hours', value: number): void {
    const control = this.form.controls[field];
    control.setValue((control.value ?? []).filter((item) => item !== value));
    this.form.markAsDirty();
  }

  /** Empties the chosen weekdays and hours; the clock and the dates stay for the next pick. */
  protected resetSelection(): void {
    this.form.patchValue({ weekdays: [], hours: [] });
    this.form.controls.weekdays.markAsUntouched();
    this.form.controls.hours.markAsUntouched();
  }

  protected assign(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.run(
      this.api.post('/api/grid/assign', {
        body: { ...this.range(), clock_id: value.clock_id ?? 0 },
      }),
    );
  }

  protected clear(): void {
    if (!this.canClear() || this.busy()) {
      return;
    }
    this.run(this.api.post('/api/grid/unassign', { body: this.range() }));
  }

  protected removeSlot(slot: GridSlot): void {
    this.confirm
      .confirmDelete({
        name: this.describeSlot(slot),
        action: () => this.api.delete('/api/grid/slots/{id}', { path: { id: slot.id } }),
      })
      .subscribe((deleted) => {
        if (deleted) {
          this.reload();
        }
      });
  }

  protected describeSlot(slot: GridSlot): string {
    return this.i18n.translate('grid.slots.describe', {
      day: this.dayName(slot.weekday),
      hour: hourLabel(slot.hour),
      clock: slot.clock.name,
      from: this.dateText(slot.valid_from),
      to: slot.valid_to ? this.dateText(slot.valid_to) : this.i18n.translate('grid.slots.openEnd'),
    });
  }

  protected dayName(weekday: number): string {
    return weekdayName(weekday, this.i18n.locale());
  }

  /** A station local date, formatted without shifting it through any zone. */
  protected dateText(date: string | undefined): string {
    if (!date) {
      return '';
    }
    return new Intl.DateTimeFormat(this.i18n.locale(), {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(localDateAsUtcNoon(date));
  }

  private range() {
    const value = this.form.getRawValue();
    return {
      weekdays: value.weekdays ?? [],
      hours: value.hours ?? [],
      valid_from: value.valid_from ?? '',
      valid_to: value.valid_to || null,
    };
  }

  private run(request: Observable<GridAssignResult>): void {
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    request
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.form.markAsPristine();
          this.reload();
          if (result.build_operation_id !== undefined) {
            this.watchBuild(result.build_operation_id);
          }
        },
        error: (error: unknown) => this.error.set(applySubmitError(this.form, error, this.i18n)),
      });
  }

  private reload(): void {
    this.week.reload();
    this.slots.reload();
  }

  // A failed build is already an error.alert popup; the page only says when the hours are ready.
  private watchBuild(id: number): void {
    this.buildStatus.set('running');
    this.operations
      .waitFor(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => this.buildStatus.set(state.status));
  }
}

function addSorted(values: readonly number[] | null, value: number): number[] {
  return [...new Set([...(values ?? []), value])].sort((a, b) => a - b);
}

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
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { finalize, map, merge, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { followOperation } from '../../core/operations/operation-run';
import { OperationStatus, OperationsService } from '../../core/operations/operations.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PlanWarningsService, TrackPlanWarning } from '../../core/rotation/plan-warnings.service';
import { SettingsService } from '../../core/settings/settings.service';
import { formatHourOffset } from '../../core/time/duration';
import { addDays, stationMidnightUtc, stationToday } from '../../core/time/local-date';
import { StationTimeService } from '../../core/time/station-time.service';
import { DateInputComponent } from '../../shared/forms/date-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { dateRangeValidator } from '../../shared/forms/validators';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { HourInsertDialogComponent, HourInsertDialogData } from './hour-insert-dialog.component';
import { PlanHourView, PlanInsertView, TrackPlanHourComponent } from './track-plan-hour.component';

type TrackPlanHour = ApiSchema<'TrackPlanHour'>;
type TrackPlanInsert = ApiSchema<'TrackPlanInsert'>;
type TrackPlanFullData = ApiSchema<'TrackPlanFullData'>;

/** The last full pass that ended, as the panel shows it. */
interface FullPassResult {
  built: number;
  skipped: number;
  items: number;
  seconds: string;
}

/** A rebuild or a read covers at most one month: 31 days, both dates included. */
export const PLAN_RANGE_MAX_DAYS = 31;
/** The dates may lie from today to this many days ahead (six months, station local). */
export const PLAN_WINDOW_DAYS = 183;
const HOUR_MS = 3_600_000;
/** Used when the setting of a new insert's tolerance is not loaded: ±1 minute. */
const DEFAULT_INSERT_TOLERANCE_MS = 60_000;

interface PlanRange {
  from: string;
  to: string;
}

/**
 * The track plan (design §7): the tracks the engine chose for the built hours of a range of station
 * dates, with the warnings of each build. The panel shows the plan and never computes it. The view
 * follows the backend: it reloads when the plan job, a rebuild, or a one-time insert completes. A
 * rebuild of the range is a `clock_build` operation; hours that have started are kept by the
 * backend. An hour that has not started takes one-time inserts (frontend F21 §5.4), each an
 * `hour_insert` operation that rebuilds the hour around it.
 */
@Component({
  selector: 'app-track-plan-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    TranslatePipe,
    DateInputComponent,
    OperationStatusComponent,
    PageHeaderComponent,
    TrackPlanHourComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="trackPlan.title" helpPage="help.track-plan" />

    <section class="page-section" aria-labelledby="range-heading">
      <h2 id="range-heading" class="section-title">{{ 'trackPlan.range.title' | translate }}</h2>
      <p class="muted">
        {{ 'trackPlan.range.note' | translate: { zone: zone(), days: maxDays } }}
      </p>
      <form class="range" [formGroup]="form" (ngSubmit)="rebuild()">
        <app-date-input
          [control]="form.controls.from"
          label="trackPlan.fields.from"
          [min]="today()"
          [max]="windowEnd()"
          hintPage="help.track-plan"
          hintField="from"
        />
        <app-date-input
          [control]="form.controls.to"
          label="trackPlan.fields.to"
          [min]="form.controls.from.value"
          [max]="maxTo()"
          hintPage="help.track-plan"
          hintField="to"
        />
        <div class="form-actions">
          <button matButton type="button" (click)="showToday()">
            {{ 'trackPlan.range.reset' | translate }}
          </button>
          <button matButton="filled" type="submit" [disabled]="!range() || rebuilding()">
            {{ 'trackPlan.rebuild.action' | translate }}
          </button>
        </div>
      </form>
      <p class="muted">{{ 'trackPlan.rebuild.note' | translate }}</p>
      @if (rebuildError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      @if (rebuildStatus(); as status) {
        <p class="muted" role="status">{{ 'clocks.build.' + status | translate }}</p>
      }
    </section>

    <section class="page-section" aria-labelledby="hours-heading">
      <h2 id="hours-heading" class="section-title">{{ 'trackPlan.hours.title' | translate }}</h2>
      <p class="muted">{{ 'trackPlan.hours.warningsNote' | translate }}</p>
      @if (plan.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (planError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="plan.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <app-operation-status [state]="insertRun.state()" runningLabel="trackPlan.inserts.running" />
      @for (view of hours(); track view.hour.hour_start_utc) {
        <app-track-plan-hour
          [view]="view"
          (addInsert)="openAddInsert(view.hour)"
          (removeInsert)="removeInsert($event)"
        />
      } @empty {
        @if (plan.hasValue()) {
          <p class="muted">{{ 'trackPlan.hours.empty' | translate }}</p>
        }
      }
    </section>

    <section class="page-section" aria-labelledby="full-heading">
      <h2 id="full-heading" class="section-title">{{ 'trackPlan.fullPass.title' | translate }}</h2>
      <p class="muted">{{ 'trackPlan.fullPass.note' | translate }}</p>
      <div class="form-actions">
        <button
          matButton="filled"
          type="button"
          [disabled]="fullPassBusy()"
          (click)="startFullPass()"
        >
          {{ 'trackPlan.fullPass.action' | translate }}
        </button>
      </div>
      @if (fullPassError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      @if (fullPassStatus(); as status) {
        <p class="muted" role="status">{{ 'trackPlan.fullPass.' + status | translate }}</p>
      }
      <app-operation-status [state]="fullRun.state()" runningLabel="trackPlan.fullPass.running" />
      @if (fullPassLast(); as last) {
        <p class="muted">
          {{
            'trackPlan.fullPass.last'
              | translate
                : {
                    built: last.built,
                    skipped: last.skipped,
                    items: last.items,
                    seconds: last.seconds,
                  }
          }}
        </p>
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .range {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: baseline;
    }
  `,
})
export default class TrackPlanPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly operations = inject(OperationsService);
  private readonly warnings = inject(PlanWarningsService);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly zone = inject(StationTimeService).zone;

  protected readonly form = new FormGroup(
    {
      from: new FormControl<string | null>(null, Validators.required),
      to: new FormControl<string | null>(null, Validators.required),
    },
    { validators: dateRangeValidator('from', 'to', PLAN_RANGE_MAX_DAYS) },
  );
  private readonly version = controlVersion(signal(this.form));

  protected readonly maxDays = PLAN_RANGE_MAX_DAYS;
  protected readonly today = computed(() => stationToday(this.zone()));
  /** The last date that may be picked: six months ahead of today. */
  protected readonly windowEnd = computed(() => addDays(this.today(), PLAN_WINDOW_DAYS));

  /** The last date of the range: one month after the first, and never past the window. */
  protected readonly maxTo = computed(() => {
    this.version();
    const from = this.form.controls.from.value;
    const windowEnd = this.windowEnd();
    if (!from) {
      return windowEnd;
    }
    const rangeEnd = addDays(from, PLAN_RANGE_MAX_DAYS - 1);
    return rangeEnd < windowEnd ? rangeEnd : windowEnd;
  });

  /** The range as UTC instants; null while the form is invalid. */
  protected readonly range = computed((): PlanRange | null => {
    this.version();
    const { from, to } = this.form.getRawValue();
    if (this.form.invalid || !from || !to) {
      return null;
    }
    const zone = this.zone();
    return { from: stationMidnightUtc(from, zone), to: stationMidnightUtc(addDays(to, 1), zone) };
  });

  protected readonly plan = rxResource({
    params: () => this.range() ?? undefined,
    stream: ({ params }) =>
      this.api.get('/api/track-plan', { query: params }).pipe(map((plan) => plan.items)),
  });
  protected readonly planError = computed(() =>
    this.plan.status() === 'error' ? errorMessage(this.plan.error(), this.i18n) : null,
  );
  protected readonly hours = computed(() => {
    // Whether an hour has started is judged when the plan is read; the backend refuses the rest.
    const now = Date.now();
    return (this.plan.hasValue() ? this.plan.value() : []).map((hour) => this.viewOf(hour, now));
  });

  protected readonly rebuilding = signal(false);
  protected readonly rebuildStatus = signal<OperationStatus | null>(null);
  protected readonly rebuildError = signal<string | null>(null);
  /** The last one-time insert added or removed, followed until its hour is rebuilt. */
  protected readonly insertRun = followOperation();
  /** The full pass started from this page, followed for its progress and its status line. */
  protected readonly fullRun = followOperation();
  protected readonly fullPassError = signal<string | null>(null);
  protected readonly fullPassStatus = signal<'started' | 'completed' | 'failed' | null>(null);
  protected readonly fullPassLast = signal<FullPassResult | null>(null);
  /** True from a `rotation.plan_full` start event until its end, whoever started the pass. */
  private readonly fullPassRunning = signal(false);
  protected readonly fullPassBusy = computed(
    () => this.fullPassRunning() || this.fullRun.running(),
  );

  constructor() {
    this.showToday();
    const realtime = inject(RealtimeService);
    // The plan job runs every few minutes and a rebuild may come from any page; both end with an
    // event, so the view stays current without polling.
    merge(
      realtime.on('track_plan.completed'),
      realtime.on('clock_build.completed'),
      realtime.on('hour_insert.completed'),
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.plan.reload());
    // The nightly pass and the button both send these; the button is held until the end arrives.
    realtime
      .on('rotation.plan_full')
      .pipe(takeUntilDestroyed())
      .subscribe((event) => this.onFullPass(event.data));
  }

  protected startFullPass(): void {
    if (this.fullPassBusy()) {
      return;
    }
    this.fullPassError.set(null);
    // A refused start (track_plan_full_running) is shown here; a failed pass is an error.alert.
    this.fullRun
      .run(this.api.post('/api/track-plan/rebuild-full'))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (error: unknown) => this.fullPassError.set(errorMessage(error, this.i18n)),
      });
  }

  private onFullPass(data: TrackPlanFullData): void {
    this.fullPassStatus.set(data.status);
    this.fullPassRunning.set(data.status === 'started');
    if (data.status === 'started') {
      return;
    }
    this.fullPassLast.set({
      built: data.hours_built,
      skipped: data.hours_skipped,
      items: data.items,
      seconds: new Intl.NumberFormat(this.i18n.locale(), { maximumFractionDigits: 1 }).format(
        data.elapsed_ms / 1000,
      ),
    });
    this.plan.reload();
  }

  /** Today and tomorrow in the station zone, the part of the plan that is always built. */
  protected showToday(): void {
    const today = stationToday(this.zone());
    this.form.setValue({ from: today, to: addDays(today, 1) });
  }

  protected rebuild(): void {
    const range = this.range();
    if (!range || this.rebuilding()) {
      this.form.markAllAsTouched();
      return;
    }
    this.rebuilding.set(true);
    this.rebuildError.set(null);
    this.rebuildStatus.set('accepted');
    // A failed build is already an error.alert popup; the page says only how it ended.
    this.operations
      .runOperation(this.api.post('/api/track-plan/rebuild', { body: range }))
      .pipe(
        finalize(() => this.rebuilding.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (state) => this.rebuildStatus.set(state.status),
        error: (error: unknown) => {
          this.rebuildStatus.set(null);
          this.rebuildError.set(errorMessage(error, this.i18n));
        },
      });
  }

  protected openAddInsert(hour: TrackPlanHour): void {
    const setting: unknown = this.settings.get('rotation.default_fixed_tolerance_ms')?.value;
    this.dialog
      .open<HourInsertDialogComponent, HourInsertDialogData, number>(HourInsertDialogComponent, {
        data: {
          hourStartUtc: hour.hour_start_utc,
          toleranceMs: typeof setting === 'number' ? setting : DEFAULT_INSERT_TOLERANCE_MS,
        },
        width: '40rem',
        maxWidth: 'calc(100vw - 2rem)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((operationId) => {
        if (operationId !== undefined) {
          this.follow(operationId);
        }
      });
  }

  protected removeInsert(row: PlanInsertView): void {
    let operationId: number | undefined;
    this.confirm
      .confirm({
        title: 'trackPlan.inserts.removeTitle',
        message:
          row.insert.missed_id === undefined
            ? 'trackPlan.inserts.removeMessage'
            : 'trackPlan.inserts.removeRescheduledMessage',
        params: { title: row.title, at: row.at },
        confirmLabel: 'common.remove',
        destructive: true,
        action: () =>
          this.api
            .delete('/api/track-plan/inserts/{id}', { path: { id: row.insert.id } })
            .pipe(tap((accepted) => (operationId = accepted.operation_id))),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((removed) => {
        if (removed && operationId !== undefined) {
          this.follow(operationId);
        }
      });
  }

  // A failed operation is already an error.alert popup; the line only says how it ended.
  private follow(operationId: number): void {
    this.insertRun
      .run(of({ operation_id: operationId }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private viewOf(hour: TrackPlanHour, now: number): PlanHourView {
    const titles = new Map(hour.items.map((item) => [item.track_id, item.title]));
    return {
      editable: Date.parse(hour.hour_start_utc) > now,
      inserts: hour.inserts.map((insert) => ({
        insert,
        at: this.insertAt(insert),
        title: titles.get(insert.track_id) ?? `#${insert.track_id}`,
      })),
      hour,
      endUtc: new Date(Date.parse(hour.hour_start_utc) + HOUR_MS).toISOString(),
      rows: hour.items.map((item) => ({
        item,
        preview: {
          id: item.track_id,
          title: item.title,
          artist: item.artist_name ? { name: item.artist_name } : undefined,
        },
      })),
      warnings: this.warnings
        .forHour(hour.hour_start_utc, hour.built_at)
        .map((warning) => this.describe(warning, hour, titles)),
    };
  }

  private insertAt(insert: TrackPlanInsert): string {
    return insert.placement === 'fixed' && insert.offset_ms !== undefined
      ? formatHourOffset(insert.offset_ms)
      : this.i18n.translate(`trackPlan.inserts.placements.${insert.placement}`);
  }

  private describe(
    warning: TrackPlanWarning,
    hour: TrackPlanHour,
    titles: ReadonlyMap<number, string>,
  ): string {
    const key = `trackPlan.warnings.${warning.code}`;
    if (!this.i18n.has(key)) {
      return warning.message;
    }
    const track = warning.track_id;
    return this.i18n.translate(key, {
      playlist: (warning.playlist_index ?? 0) + 1,
      insert: this.warningInsert(warning, hour),
      track: track === undefined ? '' : (titles.get(track) ?? `#${track}`),
    });
  }

  // A one-time insert is named by its time; a template insert by its place in the clock.
  private warningInsert(warning: TrackPlanWarning, hour: TrackPlanHour): string {
    const insert = hour.inserts.find((item) => item.id === warning.hour_insert_id);
    if (insert) {
      return this.insertAt(insert);
    }
    return String((warning.insert_index ?? 0) + 1);
  }
}

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
import { finalize, map, merge } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { OperationStatus, OperationsService } from '../../core/operations/operations.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PlanWarningsService, TrackPlanWarning } from '../../core/rotation/plan-warnings.service';
import { addDays, stationMidnightUtc, stationToday } from '../../core/time/local-date';
import { StationTimeService } from '../../core/time/station-time.service';
import { DateInputComponent } from '../../shared/forms/date-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { dateRangeValidator } from '../../shared/forms/validators';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlanHourView, TrackPlanHourComponent } from './track-plan-hour.component';

type TrackPlanHour = ApiSchema<'TrackPlanHour'>;

/** The API reads at most 7 days of the plan at once. */
export const PLAN_RANGE_MAX_DAYS = 7;
const HOUR_MS = 3_600_000;

interface PlanRange {
  from: string;
  to: string;
}

/**
 * The track plan (design §7): the tracks the engine chose for the built hours of a range of station
 * dates, with the warnings of each build. The panel shows the plan and never computes it. The view
 * follows the backend: it reloads when the plan job or a rebuild completes. A rebuild of the range
 * is a `clock_build` operation; hours that have started are kept by the backend.
 */
@Component({
  selector: 'app-track-plan-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    TranslatePipe,
    DateInputComponent,
    PageHeaderComponent,
    TrackPlanHourComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="trackPlan.title" helpPage="help.track-plan" />

    <section class="page-section" aria-labelledby="range-heading">
      <h2 id="range-heading" class="section-title">{{ 'trackPlan.range.title' | translate }}</h2>
      <p class="muted">{{ 'trackPlan.range.note' | translate: { zone: zone() } }}</p>
      <form class="range" [formGroup]="form" (ngSubmit)="rebuild()">
        <app-date-input
          [control]="form.controls.from"
          label="trackPlan.fields.from"
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
      @for (view of hours(); track view.hour.hour_start_utc) {
        <app-track-plan-hour [view]="view" />
      } @empty {
        @if (plan.hasValue()) {
          <p class="muted">{{ 'trackPlan.hours.empty' | translate }}</p>
        }
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

  protected readonly maxTo = computed(() => {
    this.version();
    const from = this.form.controls.from.value;
    return from ? addDays(from, PLAN_RANGE_MAX_DAYS - 1) : null;
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
  protected readonly hours = computed(() =>
    (this.plan.hasValue() ? this.plan.value() : []).map((hour) => this.viewOf(hour)),
  );

  protected readonly rebuilding = signal(false);
  protected readonly rebuildStatus = signal<OperationStatus | null>(null);
  protected readonly rebuildError = signal<string | null>(null);

  constructor() {
    this.showToday();
    const realtime = inject(RealtimeService);
    // The plan job runs every few minutes and a rebuild may come from any page; both end with an
    // event, so the view stays current without polling.
    merge(realtime.on('track_plan.completed'), realtime.on('clock_build.completed'))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.plan.reload());
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

  private viewOf(hour: TrackPlanHour): PlanHourView {
    const titles = new Map(hour.items.map((item) => [item.track_id, item.title]));
    return {
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
        .map((warning) => this.describe(warning, titles)),
    };
  }

  private describe(warning: TrackPlanWarning, titles: ReadonlyMap<number, string>): string {
    const key = `trackPlan.warnings.${warning.code}`;
    if (!this.i18n.has(key)) {
      return warning.message;
    }
    const track = warning.track_id;
    return this.i18n.translate(key, {
      element: (warning.element_index ?? 0) + 1,
      segment: (warning.segment_index ?? 0) + 1,
      track: track === undefined ? '' : (titles.get(track) ?? `#${track}`),
    });
  }
}

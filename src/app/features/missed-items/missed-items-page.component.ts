import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { finalize, map, merge } from 'rxjs';
import { MissedItemsService } from '../../core/alerts/missed-items.service';
import { ApiClient, ApiOperation } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { OperationStatus, OperationsService } from '../../core/operations/operations.service';
import type { PreviewTrack } from '../../core/player/player.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { controlErrorMessage, controlVersion } from '../../shared/forms/field-errors';
import { applySubmitError } from '../../shared/forms/server-errors';
import { rangeValidator } from '../../shared/forms/validators';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';

type MissedItem = ApiSchema<'PlayHistoryEntry'>;
type Placement = ApiSchema<'RescheduleBody'>['placement'];
type Resolution = NonNullable<
  NonNullable<ApiOperation<'/api/missed-items', 'get'>['parameters']['query']>['resolution']
>;

export const RESOLUTIONS: readonly Resolution[] = ['open', 'rescheduled', 'dismissed'];
export const PLACEMENTS: readonly Placement[] = ['start', 'end', 'fixed'];
/** `RescheduleBody` limits. */
export const RESCHEDULE_LIMITS = { minuteMax: 59, toleranceMax: 600_000 } as const;
/** Target hours are offered from the plan of the next 7 days, the most the API reads at once. */
export const TARGET_WINDOW_MS = 7 * 86_400_000;

interface MissedRow {
  item: MissedItem;
  preview: PreviewTrack;
}

/**
 * Missed items (design §7.1): items an outage kept off the air. Each open one is rescheduled into a
 * later planned hour, at its start, its end, or a fixed minute, for that hour only, or dismissed.
 * The reschedule is a `reschedule` operation: the backend rebuilds the hour around the item and
 * refuses it when the track breaks a rule at its place or does not fit, which arrives as an
 * error popup.
 */
@Component({
  selector: 'app-missed-items-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    StationTimePipe,
    FieldHintComponent,
    NumberInputComponent,
    PageHeaderComponent,
    PlayButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="missedItems.title" helpPage="help.missed-items" />

    <div class="list-filters">
      <mat-form-field>
        <mat-label>{{ 'missedItems.resolutionLabel' | translate }}</mat-label>
        <mat-select [formControl]="resolutionFilter">
          @for (resolution of resolutions; track resolution) {
            <mat-option [value]="resolution">
              {{ 'missedItems.filter.' + resolution | translate }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
      <a matButton routerLink="/played-tracks">{{ 'missedItems.historyLink' | translate }}</a>
    </div>

    @if (notice(); as message) {
      <p class="muted" role="status">{{ message }}</p>
    }
    @if (items.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="items.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table class="missed">
        <thead>
          <tr>
            <th scope="col">{{ 'missedItems.columns.planned' | translate }}</th>
            <th scope="col">
              <span class="cdk-visually-hidden">{{
                'missedItems.columns.preview' | translate
              }}</span>
            </th>
            <th scope="col">{{ 'missedItems.columns.title' | translate }}</th>
            <th scope="col">{{ 'missedItems.columns.length' | translate }}</th>
            <th scope="col">{{ 'missedItems.columns.clock' | translate }}</th>
            <th scope="col">{{ 'missedItems.columns.outage' | translate }}</th>
            <th scope="col">{{ 'missedItems.resolutionLabel' | translate }}</th>
            <th scope="col">
              <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.item.id) {
            @let item = row.item;
            <tr>
              <td class="time">{{ item.planned_start_utc | stationTime: 'datetime-seconds' }}</td>
              <td><app-play-button [track]="row.preview" /></td>
              <td>
                {{ item.title }}
                @if (item.artist_name) {
                  <span class="muted"> — {{ item.artist_name }}</span>
                }
              </td>
              <td class="time">{{ item.planned_out_ms | duration }}</td>
              <td>
                @if (item.clock; as clock) {
                  @if (clock.name) {
                    <a [routerLink]="['/clocks', clock.id]">{{ clock.name }}</a>
                  } @else {
                    <span class="muted">{{ 'playedTracks.deletedClock' | translate }}</span>
                  }
                }
              </td>
              <td class="outage">
                @if (item.outage; as outage) {
                  {{ 'alerts.outage.components.' + outage.component | translate }}
                  @if (outage.reason) {
                    <span class="muted"> — {{ outage.reason }}</span>
                  }
                }
              </td>
              <td>
                @if (item.resolution === 'open' || !item.resolution) {
                  <span class="badge warn">{{ 'playedTracks.statuses.missed' | translate }}</span>
                } @else {
                  {{
                    'missedItems.resolutions.' + item.resolution
                      | translate: { time: (item.resolved_at | stationTime) }
                  }}
                }
              </td>
              <td class="cell-actions">
                @if (item.resolution === 'open' && rescheduling() !== item.id) {
                  <button matButton type="button" (click)="startReschedule(item)">
                    {{ 'missedItems.reschedule' | translate }}
                  </button>
                  <button matButton type="button" (click)="dismiss(item)">
                    {{ 'missedItems.dismiss' | translate }}
                  </button>
                }
              </td>
            </tr>
            @if (rescheduling() === item.id) {
              <tr class="form-row">
                <td colspan="8">
                  <form [formGroup]="form" (ngSubmit)="submit(item)">
                    <p class="muted">
                      {{ 'missedItems.rescheduleNote' | translate: { title: item.title } }}
                    </p>
                    @if (targetsError(); as message) {
                      <p class="load-error" role="alert">
                        {{ message }}
                        <button matButton type="button" (click)="targets.reload()">
                          {{ 'common.retry' | translate }}
                        </button>
                      </p>
                    } @else if (targets.hasValue() && targets.value().length === 0) {
                      <p class="muted">{{ 'missedItems.noTargets' | translate }}</p>
                    }
                    <div class="form-grid">
                      <div class="field-row">
                        <mat-form-field>
                          <mat-label>{{
                            'missedItems.fields.target_hour_start_utc' | translate
                          }}</mat-label>
                          <mat-select [formControl]="form.controls.target_hour_start_utc">
                            @for (hour of targetHours(); track hour.hour_start_utc) {
                              <mat-option [value]="hour.hour_start_utc">
                                {{ hour.hour_start_utc | stationTime }} — {{ hour.clock.name }}
                              </mat-option>
                            }
                          </mat-select>
                          @if (targetError(); as message) {
                            <mat-error>{{ message }}</mat-error>
                          }
                        </mat-form-field>
                        <app-field-hint page="help.missed-items" field="target_hour_start_utc" />
                      </div>
                      <div class="field-row">
                        <mat-form-field>
                          <mat-label>{{ 'missedItems.fields.placement' | translate }}</mat-label>
                          <mat-select [formControl]="form.controls.placement">
                            @for (placement of placements; track placement) {
                              <mat-option [value]="placement">
                                {{ 'missedItems.placements.' + placement | translate }}
                              </mat-option>
                            }
                          </mat-select>
                          @if (placementError(); as message) {
                            <mat-error>{{ message }}</mat-error>
                          }
                        </mat-form-field>
                        <app-field-hint page="help.missed-items" field="placement" />
                      </div>
                      @if (fixed()) {
                        <app-number-input
                          [control]="form.controls.fixed_minute"
                          label="missedItems.fields.fixed_minute"
                          [min]="0"
                          [max]="limits.minuteMax"
                          suffix="forms.units.minutes"
                          hintPage="help.missed-items"
                          hintField="fixed_minute"
                        />
                        <app-number-input
                          [control]="form.controls.fixed_tolerance_ms"
                          label="missedItems.fields.fixed_tolerance_ms"
                          [min]="0"
                          [max]="limits.toleranceMax"
                          [step]="1000"
                          suffix="forms.units.ms"
                          hintPage="help.missed-items"
                          hintField="fixed_tolerance_ms"
                        />
                      }
                    </div>
                    @if (error(); as message) {
                      <p class="form-error" role="alert">{{ message }}</p>
                    }
                    @if (status(); as current) {
                      <p class="muted" role="status">
                        {{ 'missedItems.status.' + current | translate }}
                      </p>
                    }
                    <div class="form-actions">
                      <button matButton="filled" type="submit" [disabled]="busy() || !canSave()">
                        {{ 'missedItems.save' | translate }}
                      </button>
                      <button matButton type="button" [disabled]="busy()" (click)="cancel()">
                        {{ 'common.cancel' | translate }}
                      </button>
                    </div>
                  </form>
                </td>
              </tr>
            }
          } @empty {
            @if (!items.isLoading() && !loadError()) {
              <tr>
                <td class="muted" colspan="8">{{ 'missedItems.empty' | translate }}</td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .missed {
      width: 100%;
      border-collapse: collapse;
    }

    .missed th,
    .missed td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    .time {
      white-space: nowrap;
    }

    .outage {
      overflow-wrap: anywhere;
    }

    .form-row td {
      padding: 0.5rem 0.5rem 1rem;
    }
  `,
})
export default class MissedItemsPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly confirm = inject(ConfirmService);
  private readonly operations = inject(OperationsService);
  private readonly missedItems = inject(MissedItemsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly resolutions = RESOLUTIONS;
  protected readonly placements = PLACEMENTS;
  protected readonly limits = RESCHEDULE_LIMITS;

  protected readonly resolutionFilter = new FormControl<Resolution>('open', { nonNullable: true });
  private readonly resolution = toSignal(this.resolutionFilter.valueChanges, {
    initialValue: this.resolutionFilter.value,
  });

  protected readonly items = rxResource({
    params: () => ({ resolution: this.resolution() }),
    stream: ({ params }) =>
      this.api.get('/api/missed-items', { query: params }).pipe(map((list) => list.items ?? [])),
  });
  protected readonly rows = computed((): MissedRow[] =>
    (this.items.hasValue() ? this.items.value() : []).map((item) => ({
      item,
      preview: {
        id: item.track_id,
        title: item.title,
        artist: item.artist_name ? { name: item.artist_name } : undefined,
      },
    })),
  );
  protected readonly loadError = computed(() =>
    this.items.status() === 'error' ? errorMessage(this.items.error(), this.i18n) : null,
  );

  // Control names are the RescheduleBody's JSON names, so per-field refusals land on them.
  protected readonly form = new FormGroup({
    target_hour_start_utc: new FormControl<string | null>(null, Validators.required),
    placement: new FormControl<Placement>('start', { nonNullable: true }),
    fixed_minute: new FormControl<number | null>({ value: null, disabled: true }, [
      Validators.required,
      rangeValidator({ min: 0, max: RESCHEDULE_LIMITS.minuteMax, step: 1 }),
    ]),
    fixed_tolerance_ms: new FormControl<number | null>(
      { value: null, disabled: true },
      rangeValidator({ min: 0, max: RESCHEDULE_LIMITS.toleranceMax, step: 1 }),
    ),
  });
  private readonly version = controlVersion(signal(this.form));
  protected readonly canSave = computed(() => {
    this.version();
    return this.form.valid;
  });
  protected readonly fixed = computed(() => {
    this.version();
    return this.form.controls.placement.value === 'fixed';
  });
  protected readonly targetError = controlErrorMessage(
    signal(this.form.controls.target_hour_start_utc),
  );
  protected readonly placementError = controlErrorMessage(signal(this.form.controls.placement));

  /** The item whose reschedule form is open. */
  protected readonly rescheduling = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly status = signal<OperationStatus | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Planned hours that have not started, read only while a reschedule form is open. */
  protected readonly targets = rxResource({
    params: () => (this.rescheduling() === null ? undefined : true),
    stream: () => {
      const now = Date.now();
      return this.api
        .get('/api/track-plan', {
          query: {
            from: new Date(now).toISOString(),
            to: new Date(now + TARGET_WINDOW_MS).toISOString(),
          },
        })
        .pipe(map((plan) => plan.items));
    },
  });
  protected readonly targetHours = computed(() =>
    this.targets.hasValue() ? this.targets.value() : [],
  );
  protected readonly targetsError = computed(() =>
    this.targets.status() === 'error' ? errorMessage(this.targets.error(), this.i18n) : null,
  );

  constructor() {
    this.form.controls.placement.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((placement) => this.syncFixed(placement));

    // Items marked after an outage, or resolved anywhere: read the list again.
    this.missedItems.changes$.pipe(takeUntilDestroyed()).subscribe(() => this.items.reload());
    const realtime = inject(RealtimeService);
    merge(realtime.on('track_plan.completed'), realtime.on('clock_build.completed'))
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.rescheduling() !== null) {
          this.targets.reload();
        }
      });
  }

  protected startReschedule(item: MissedItem): void {
    this.form.reset({
      target_hour_start_utc: null,
      placement: 'start',
      fixed_minute: null,
      fixed_tolerance_ms: null,
    });
    this.syncFixed('start');
    this.error.set(null);
    this.status.set(null);
    this.notice.set(null);
    this.rescheduling.set(item.id);
  }

  protected cancel(): void {
    this.rescheduling.set(null);
    this.error.set(null);
    this.status.set(null);
  }

  protected submit(item: MissedItem): void {
    const value = this.form.getRawValue();
    if (this.form.invalid || !value.target_hour_start_utc || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const fixed = value.placement === 'fixed';
    const body: ApiSchema<'RescheduleBody'> = {
      target_hour_start_utc: value.target_hour_start_utc,
      placement: value.placement,
      ...(fixed && value.fixed_minute !== null ? { fixed_minute: value.fixed_minute } : {}),
      ...(fixed && value.fixed_tolerance_ms !== null
        ? { fixed_tolerance_ms: value.fixed_tolerance_ms }
        : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    this.status.set('accepted');
    // A failed operation is already an error.alert popup with the reason; the form stays open so
    // another hour or placement can be tried.
    this.operations
      .runOperation(
        this.api.post('/api/missed-items/{id}/reschedule', { path: { id: item.id }, body }),
      )
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (state) => {
          this.status.set(state.status);
          if (state.status === 'completed') {
            this.rescheduling.set(null);
            this.status.set(null);
            this.notice.set(this.i18n.translate('missedItems.rescheduled', { title: item.title }));
            this.missedItems.refresh();
          }
        },
        error: (error: unknown) => {
          this.status.set(null);
          this.error.set(applySubmitError(this.form, error, this.i18n));
          if (error instanceof ApiProblem && error.code === 'missed_item_resolved') {
            this.missedItems.refresh();
          }
        },
      });
  }

  protected dismiss(item: MissedItem): void {
    this.notice.set(null);
    this.confirm
      .confirm({
        title: 'missedItems.dismissDialog.title',
        message: 'missedItems.dismissDialog.message',
        params: { title: item.title },
        confirmLabel: 'missedItems.dismiss',
        destructive: true,
        action: () => this.api.post('/api/missed-items/{id}/dismiss', { path: { id: item.id } }),
      })
      .subscribe((dismissed) => {
        if (dismissed) {
          this.notice.set(this.i18n.translate('missedItems.dismissed', { title: item.title }));
          this.missedItems.refresh();
        }
      });
  }

  /** The fixed minute and its tolerance apply only to a fixed placement; otherwise not sent. */
  private syncFixed(placement: Placement): void {
    for (const control of [
      this.form.controls.fixed_minute,
      this.form.controls.fixed_tolerance_ms,
    ]) {
      if (placement === 'fixed') {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    this.form.updateValueAndValidity();
  }
}

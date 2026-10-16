import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { finalize, map } from 'rxjs';
import { ApiClient, ApiOperation } from '../../core/api/api-client.service';
import { ApiProblem, ApiProblemCode } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FillerRemindersService } from '../../core/rotation/filler-reminders.service';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { applySubmitError } from '../../shared/forms/server-errors';
import { nonEmptyValidator } from '../../shared/forms/validators';
import { TrackPickerComponent } from '../../shared/pickers/track-picker.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

type FillerRequest = ApiSchema<'FillerRequest'>;
type StatusFilter = NonNullable<
  NonNullable<ApiOperation<'/api/filler-requests', 'get'>['parameters']['query']>['status']
>;

export const REMINDER_STATUSES: readonly StatusFilter[] = [
  'pending',
  'answered',
  'defaulted',
  'expired',
  'all',
];

// The answer is refused with these when the reminder closed meanwhile; the list is then stale.
const CLOSED_CODES: readonly ApiProblemCode[] = ['filler_request_closed', 'hour_started'];

/**
 * Filler reminders (design §7, "Filler reminders"): hours whose clock is short with no filler
 * choice, or whose filler pool is empty. A short-clock reminder is answered with a track; the
 * backend checks it against separation and play rules and rebuilds the hour. A pool-empty reminder
 * is closed by refilling the clock's pool, so it links to the clock. Air never waits for an answer:
 * at the deadline the clock's default filler mode applies.
 */
@Component({
  selector: 'app-filler-reminders-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    StationTimePipe,
    PageHeaderComponent,
    TrackPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="fillerReminders.title" helpPage="help.filler-reminders" />

    <div class="list-filters">
      <mat-form-field>
        <mat-label>{{ 'fillerReminders.statusLabel' | translate }}</mat-label>
        <mat-select [formControl]="statusFilter">
          @for (status of statuses; track status) {
            <mat-option [value]="status">
              {{ 'fillerReminders.filter.' + status | translate }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (answered(); as message) {
      <p class="muted" role="status">{{ message }}</p>
    }
    @if (reminders.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="reminders.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table class="reminders">
        <thead>
          <tr>
            <th scope="col">{{ 'fillerReminders.columns.hour' | translate }}</th>
            <th scope="col">{{ 'fillerReminders.columns.clock' | translate }}</th>
            <th scope="col">{{ 'fillerReminders.columns.reason' | translate }}</th>
            <th scope="col">{{ 'fillerReminders.columns.deadline' | translate }}</th>
            <th scope="col">{{ 'fillerReminders.statusLabel' | translate }}</th>
            <th scope="col">
              <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          @for (reminder of rows(); track reminder.id) {
            <tr>
              <td>{{ reminder.hour_start_utc | stationTime }}</td>
              <td>
                <a [routerLink]="['/clocks', reminder.clock_id]">{{ reminder.clock_name }}</a>
              </td>
              <td>
                {{ 'fillerReminders.reasons.' + reminder.reason | translate }}
                <span class="muted">
                  ({{ 'fillerReminders.modes.' + reminder.mode | translate }})
                </span>
              </td>
              <td>
                {{ reminder.deadline_at | stationTime }}
                @if (reminder.status === 'pending' && overdue(reminder)) {
                  <span class="badge warn">{{ 'fillerReminders.overdue' | translate }}</span>
                }
              </td>
              <td>
                <span class="badge" [class.warn]="reminder.status === 'pending'">
                  {{ 'fillerReminders.statuses.' + reminder.status | translate }}
                </span>
              </td>
              <td class="cell-actions">
                @if (reminder.status === 'pending') {
                  @if (reminder.reason === 'pool_empty') {
                    <a matButton [routerLink]="['/clocks', reminder.clock_id]">
                      {{ 'fillerReminders.refillPool' | translate }}
                    </a>
                  } @else if (answering() !== reminder.id) {
                    <button matButton type="button" (click)="startAnswer(reminder)">
                      {{ 'fillerReminders.answer' | translate }}
                    </button>
                  }
                }
              </td>
            </tr>
            @if (answering() === reminder.id) {
              <tr class="answer-row">
                <td colspan="6">
                  <form [formGroup]="form" (ngSubmit)="submit(reminder)">
                    <p class="muted">
                      {{
                        'fillerReminders.answerNote'
                          | translate
                            : {
                                clock: reminder.clock_name,
                                hour: (reminder.hour_start_utc | stationTime),
                              }
                      }}
                    </p>
                    <app-track-picker
                      [control]="form.controls.track_id"
                      [multiple]="false"
                      label="fillerReminders.fields.track_id"
                      hintPage="help.filler-reminders"
                      hintField="track_id"
                    />
                    @if (error(); as message) {
                      <p class="form-error" role="alert">{{ message }}</p>
                    }
                    <div class="form-actions">
                      <button matButton="filled" type="submit" [disabled]="busy() || !canSave()">
                        {{ 'fillerReminders.save' | translate }}
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
            @if (!reminders.isLoading() && !loadError()) {
              <tr>
                <td class="muted" colspan="6">{{ 'fillerReminders.empty' | translate }}</td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .reminders {
      width: 100%;
      border-collapse: collapse;
    }

    .reminders th,
    .reminders td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    .answer-row td {
      padding: 0.5rem 0.5rem 1rem;
    }
  `,
})
export default class FillerRemindersPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly fillerReminders = inject(FillerRemindersService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statuses = REMINDER_STATUSES;
  protected readonly statusFilter = new FormControl<StatusFilter>('pending', { nonNullable: true });
  private readonly status = toSignal(this.statusFilter.valueChanges, {
    initialValue: this.statusFilter.value,
  });

  protected readonly reminders = rxResource({
    params: () => ({ status: this.status() }),
    stream: ({ params }) =>
      this.api.get('/api/filler-requests', { query: params }).pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() =>
    this.reminders.hasValue() ? this.reminders.value() : [],
  );
  protected readonly loadError = computed(() =>
    this.reminders.status() === 'error' ? errorMessage(this.reminders.error(), this.i18n) : null,
  );

  protected readonly form = new FormGroup({
    track_id: new FormControl<number[] | null>([], nonEmptyValidator),
  });
  private readonly version = controlVersion(signal(this.form));
  protected readonly canSave = computed(() => {
    this.version();
    return this.form.valid;
  });

  /** The reminder whose answer form is open. */
  protected readonly answering = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly answered = signal<string | null>(null);

  constructor() {
    // A new reminder, a deadline that passed in the plan job, or an answer: read the list again.
    this.fillerReminders.changes$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reminders.reload());
  }

  protected overdue(reminder: FillerRequest): boolean {
    return Date.parse(reminder.deadline_at) <= Date.now();
  }

  protected startAnswer(reminder: FillerRequest): void {
    this.form.reset({ track_id: [] });
    this.error.set(null);
    this.answered.set(null);
    this.answering.set(reminder.id);
  }

  protected cancel(): void {
    this.answering.set(null);
    this.error.set(null);
  }

  protected submit(reminder: FillerRequest): void {
    const trackId = this.form.controls.track_id.value?.[0];
    if (this.form.invalid || trackId === undefined || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api
      .post('/api/filler-requests/{id}/answer', {
        path: { id: reminder.id },
        body: { track_id: trackId },
      })
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.answering.set(null);
          this.answered.set(
            this.i18n.translate('fillerReminders.answered', {
              clock: reminder.clock_name,
            }),
          );
          this.fillerReminders.refresh();
        },
        error: (error: unknown) => {
          this.error.set(applySubmitError(this.form, error, this.i18n));
          if (error instanceof ApiProblem && CLOSED_CODES.includes(error.code)) {
            this.fillerReminders.refresh();
          }
        },
      });
  }
}

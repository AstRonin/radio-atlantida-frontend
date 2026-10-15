import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TrackPickerComponent } from '../../shared/pickers/track-picker.component';

type FillerPool = ApiSchema<'FillerPool'>;

/**
 * The filler pool of a saved clock (design §4, §7): tracks used in order when a segment in pool
 * mode needs filler. Used tracks stay as history; only the unused ones are edited, and saving
 * replaces them (`PUT /api/clocks/{id}/filler-pool`).
 */
@Component({
  selector: 'app-clock-filler-pool',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe,
    StationTimePipe,
    TrackPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pool.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="pool.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <app-track-picker
      label="clocks.pool.unused"
      [ordered]="true"
      [control]="unused"
      hintPage="help.clocks"
      hintField="pool_track_ids"
    />
    @if (error(); as message) {
      <p class="form-error" role="alert">{{ message }}</p>
    }
    <div class="form-actions">
      <button matButton="tonal" type="button" [disabled]="busy() || !dirty()" (click)="save()">
        {{ 'clocks.pool.save' | translate }}
      </button>
      @if (saved()) {
        <span class="muted" role="status">{{ 'clocks.pool.saved' | translate }}</span>
      }
    </div>

    @if (used().length > 0) {
      <h3 class="subtitle">{{ 'clocks.pool.used' | translate }}</h3>
      <ol class="used">
        @for (entry of used(); track entry.position) {
          <li>
            {{ entry.title }}
            <span class="muted">{{ entry.used_at | stationTime }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .subtitle {
      margin: 1rem 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .used {
      margin: 0;
      padding-inline-start: 1.5rem;
    }
  `,
})
export class ClockFillerPoolComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  readonly clockId = input.required<number>();

  protected readonly unused = new FormControl<number[] | null>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  private readonly version = controlVersion(signal(this.unused));
  protected readonly dirty = computed(() => {
    this.version();
    return this.unused.dirty;
  });

  protected readonly pool = rxResource({
    params: () => this.clockId(),
    stream: ({ params: id }) => this.api.get('/api/clocks/{id}/filler-pool', { path: { id } }),
  });
  protected readonly loadError = computed(() =>
    this.pool.status() === 'error' ? errorMessage(this.pool.error(), this.i18n) : null,
  );
  protected readonly used = computed(() =>
    this.pool.hasValue() ? this.pool.value().items.filter((entry) => entry.used_at) : [],
  );

  constructor() {
    effect(() => {
      if (this.pool.hasValue()) {
        const pool = this.pool.value();
        untracked(() => this.fill(pool));
      }
    });
  }

  /** Unsaved changes of the pool, for the page's unsaved-changes check. */
  hasUnsavedChanges(): boolean {
    return this.unused.dirty;
  }

  protected save(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.api
      .put('/api/clocks/{id}/filler-pool', {
        path: { id: this.clockId() },
        body: { track_ids: this.unused.value ?? [] },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pool) => {
          this.busy.set(false);
          this.saved.set(true);
          this.pool.set(pool);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.unused, error, this.i18n));
        },
      });
  }

  private fill(pool: FillerPool): void {
    const unused = pool.items
      .filter((entry) => !entry.used_at)
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.track_id);
    this.unused.reset(unused);
  }
}

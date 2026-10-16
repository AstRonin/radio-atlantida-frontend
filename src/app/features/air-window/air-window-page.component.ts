import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { debounceTime, interval, map, merge } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StationTimeService } from '../../core/time/station-time.service';
import { AirWindowListComponent } from '../../shared/air-window/air-window-list.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

/** An end and the next start arrive within milliseconds; they cause one reload. */
export const RELOAD_DEBOUNCE_MS = 250;
const PROGRESS_TICK_MS = 1000;

/**
 * The air window (backend phase-17 plan): the last items that were due, the item on air, and the
 * next items, as many as the settings `air.played_count` and `air.queued_count` say. There is no
 * polling: the list reloads on the events that move it, and only the progress of the now row ticks.
 */
@Component({
  selector: 'app-air-window-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe,
    AirWindowListComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="airWindow.title" helpPage="help.air-window" />

    <section class="page-section">
      <p class="muted">{{ 'airWindow.note' | translate: { zone: zone() } }}</p>
      @if (airWindow.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="refresh()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      } @else if (airWindow.hasValue()) {
        @let answer = airWindow.value().answer;
        <app-air-window-list
          [rows]="answer.rows ?? []"
          [controlLinkConnected]="answer.control_link_connected"
          [now]="serverNow()"
        />
      }
    </section>
  `,
})
export default class AirWindowPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);

  protected readonly zone = inject(StationTimeService).zone;

  // Bumped only while the first request is open: reload() is ignored then, and an event must
  // replace that request, not be lost. A new value drops the shown rows, so reload() comes first.
  private readonly version = signal(0);

  protected readonly airWindow = rxResource({
    params: () => this.version(),
    stream: () =>
      this.api.get('/api/air-window').pipe(
        // The progress counts on the server's clock, so a browser whose clock is off shows it right.
        map((answer) => ({ answer, clockOffsetMs: Date.parse(answer.generated_at) - Date.now() })),
      ),
  });
  protected readonly loadError = computed(() =>
    this.airWindow.status() === 'error' ? errorMessage(this.airWindow.error(), this.i18n) : null,
  );

  private readonly tick = signal(Date.now());
  protected readonly serverNow = computed(() => {
    const offset = this.airWindow.hasValue() ? this.airWindow.value().clockOffsetMs : 0;
    return this.tick() + (Number.isFinite(offset) ? offset : 0);
  });

  constructor() {
    const realtime = inject(RealtimeService);
    merge(
      // A track started or ended (its final status is written), so the blocks moved.
      realtime.on('playout.now_playing'),
      realtime.on('playout.track_ended'),
      // The control link changed, and with it the now row.
      realtime.on('liquidsoap.state'),
      // The queued rows may have changed.
      realtime.on('track_plan.completed'),
      realtime.on('clock_build.completed'),
      realtime.on('reschedule.completed'),
      // Rows are marked missed.
      realtime.on('broadcast_outage.started'),
      realtime.on('broadcast_outage.ended'),
      realtime.on('missed_items.completed'),
      // Events sent while the connection was down are lost.
      realtime.connected$,
    )
      .pipe(debounceTime(RELOAD_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe(() => this.refresh());

    interval(PROGRESS_TICK_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tick.set(Date.now()));
  }

  /** Replaces a request in flight, keeping the rows on screen until the answer comes. */
  protected refresh(): void {
    if (!this.airWindow.reload()) {
      this.version.update((version) => version + 1);
    }
  }
}

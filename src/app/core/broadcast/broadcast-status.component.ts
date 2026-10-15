import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import { I18nService } from '../i18n/i18n.service';
import { NARROW_QUERY } from '../shell/layout';
import { formatElapsedMs } from '../time/duration';
import { StationTimeService } from '../time/station-time.service';
import { BroadcastService } from './broadcast.service';

export const BROADCAST_TICK_MS = 1_000;

/**
 * The header's broadcast mark: whether listeners hear the station, and for how long. The label
 * is a polite live region, so a screen reader announces a change of state; the timer is hidden
 * from it, so it does not announce every second. Label and tooltip are computed once per change,
 * so a tick re-renders only the timer.
 */
@Component({
  selector: 'app-broadcast-status',
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="broadcast"
      [class]="status().state"
      tabindex="0"
      [matTooltip]="tooltip()"
      matTooltipClass="broadcast-tooltip"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="label" [class.cdk-visually-hidden]="narrow()" role="status" aria-live="polite">
        {{ label() }}
      </span>
      @if (elapsed(); as text) {
        <span class="timer" aria-hidden="true">{{ text }}</span>
      }
    </span>
  `,
  styles: `
    .broadcast {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
      border-radius: 4px;
      font: var(--mat-sys-label-large);
      white-space: nowrap;
    }

    .dot {
      flex: none;
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--mat-sys-outline);
    }

    .connected .dot {
      background: var(--app-status-success);
    }

    .reconnecting .dot {
      background: var(--app-status-warning);
    }

    .unreachable {
      color: var(--mat-sys-error);
    }

    .unreachable .dot {
      background: var(--mat-sys-error);
    }

    .timer {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class BroadcastStatusComponent {
  private readonly broadcast = inject(BroadcastService);
  private readonly i18n = inject(I18nService);
  private readonly time = inject(StationTimeService);

  protected readonly status = this.broadcast.status;
  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(NARROW_QUERY)
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  // Server time, advanced each second only while the state has a start.
  private readonly now = signal(0);

  protected readonly label = computed(() =>
    this.i18n.translate(`broadcast.state.${this.status().state}`),
  );

  protected readonly elapsed = computed(() => {
    const since = this.status().since;
    return since ? formatElapsedMs(this.now() - Date.parse(since)) : null;
  });

  protected readonly tooltip = computed(() => {
    const { since, reason, mount_ok: mountOk, last_check_at: checkedAt } = this.status();
    const lines: string[] = [];
    if (since) {
      lines.push(this.i18n.translate('broadcast.since', { time: this.stationTime(since) }));
    }
    if (reason) {
      lines.push(this.i18n.translate('broadcast.reason', { reason }));
    }
    if (mountOk === null || !checkedAt) {
      lines.push(this.i18n.translate('broadcast.mount.unchecked'));
    } else {
      lines.push(
        this.i18n.translate(mountOk ? 'broadcast.mount.ok' : 'broadcast.mount.failed', {
          time: this.stationTime(checkedAt),
        }),
      );
    }
    return lines.join('\n');
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.status().since) {
        return;
      }
      // Reading the offset here restarts the timer when the server clock is synced again.
      this.now.set(this.broadcast.serverNow());
      const timer = setInterval(() => this.now.set(this.broadcast.serverNow()), BROADCAST_TICK_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  private stationTime(value: string): string {
    try {
      return this.time.format(value, 'datetime-seconds');
    } catch {
      // A malformed value is a backend bug; showing it raw keeps the tooltip usable.
      return value;
    }
  }
}

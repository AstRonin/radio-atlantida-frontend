import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { RealtimeService } from './realtime.service';

/** Header indicator of the event connection: without it, live views silently go stale. */
@Component({
  selector: 'app-connection-status',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="status" [class]="state()" role="status">
      <span class="dot" aria-hidden="true"></span>
      {{ 'realtime.state.' + state() | translate }}
    </span>
  `,
  styles: `
    .status {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
      font: var(--mat-sys-label-large);
      white-space: nowrap;
    }

    .dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--mat-sys-outline);
    }

    .connected .dot {
      background: var(--mat-sys-primary);
    }

    .reconnecting {
      color: var(--mat-sys-error);
    }

    .reconnecting .dot {
      background: var(--mat-sys-error);
    }
  `,
})
export class ConnectionStatusComponent {
  protected readonly state = inject(RealtimeService).state;
}

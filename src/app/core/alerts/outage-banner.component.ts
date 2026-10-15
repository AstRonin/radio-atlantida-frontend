import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { StationTimePipe } from '../time/station-time.pipe';
import type { OpenOutage } from './outage.service';

/** The open-outage banner. It has no close button: it stays until the outage ends. */
@Component({
  selector: 'app-outage-banner',
  imports: [TranslatePipe, StationTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="banner" role="alert">
      <strong>{{ 'alerts.outage.title' | translate }}</strong>
      <span>
        {{
          'alerts.outage.since'
            | translate
              : {
                  time: (outage().startedAt | stationTime: 'datetime-seconds'),
                  component: ('alerts.outage.components.' + outage().component | translate),
                }
        }}
      </span>
      @if (outage().reason) {
        <span class="reason">{{ outage().reason }}</span>
      }
    </div>
  `,
  styles: `
    .banner {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      align-items: baseline;
      padding: 0.75rem 1.5rem;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-medium);
    }

    .reason {
      overflow-wrap: anywhere;
    }
  `,
})
export class OutageBannerComponent {
  readonly outage = input.required<OpenOutage>();
}

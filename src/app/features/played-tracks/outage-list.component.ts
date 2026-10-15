import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ApiSchema } from '../../core/api/api-types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';

/** Broadcast outages, newest first (design §7.1). Presentational; times in the station zone. */
@Component({
  selector: 'app-outage-list',
  imports: [TranslatePipe, StationTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-scroll">
      <table class="outages">
        <thead>
          <tr>
            <th scope="col">{{ 'outages.columns.started' | translate }}</th>
            <th scope="col">{{ 'outages.columns.ended' | translate }}</th>
            <th scope="col">{{ 'outages.columns.component' | translate }}</th>
            <th scope="col">{{ 'outages.columns.detectedBy' | translate }}</th>
            <th scope="col">{{ 'outages.columns.reason' | translate }}</th>
            <th scope="col">{{ 'outages.columns.missed' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (outage of outages(); track outage.id) {
            <tr>
              <td>{{ outage.started_at | stationTime: 'datetime-seconds' }}</td>
              <td>
                @if (outage.ended_at) {
                  {{ outage.ended_at | stationTime: 'datetime-seconds' }}
                } @else {
                  <span class="badge warn">{{ 'outages.open' | translate }}</span>
                }
              </td>
              <td>{{ 'alerts.outage.components.' + outage.component | translate }}</td>
              <td>{{ 'outages.detectedBy.' + outage.detected_by | translate }}</td>
              <td class="reason">{{ outage.reason }}</td>
              <td>{{ outage.missed_count }}</td>
            </tr>
          } @empty {
            <tr>
              <td class="muted" colspan="6">{{ 'outages.empty' | translate }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .outages {
      width: 100%;
      border-collapse: collapse;
    }

    .outages th,
    .outages td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    .reason {
      overflow-wrap: anywhere;
    }
  `,
})
export class OutageListComponent {
  readonly outages = input.required<readonly ApiSchema<'Outage'>[]>();
}

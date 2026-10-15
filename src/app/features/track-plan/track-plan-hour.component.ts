import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { PreviewTrack } from '../../core/player/player.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';

export interface PlanRowView {
  item: ApiSchema<'TrackPlanItem'>;
  /** What the play button needs; built once per load, not on every check. */
  preview: PreviewTrack;
}

export interface PlanHourView {
  hour: ApiSchema<'TrackPlanHour'>;
  rows: readonly PlanRowView[];
  /** UTC; the start of the next hour. */
  endUtc: string;
  /** Already translated. */
  warnings: readonly string[];
}

/**
 * One built hour of the track plan: its clock, build time, items in time order, and the engine's
 * warnings. Presentational; times are shown in the station zone.
 */
@Component({
  selector: 'app-track-plan-hour',
  imports: [RouterLink, TranslatePipe, DurationPipe, StationTimePipe, PlayButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let hour = view().hour;
    <section class="hour" [attr.aria-labelledby]="headingId()">
      <header class="hour-head">
        <h3 class="hour-title" [id]="headingId()">
          {{ hour.hour_start_utc | stationTime: 'datetime' }} –
          {{ view().endUtc | stationTime: 'time' }}
        </h3>
        <a [routerLink]="['/clocks', hour.clock.id]">{{ hour.clock.name }}</a>
        <span class="muted">
          {{ 'trackPlan.builtAt' | translate: { time: (hour.built_at | stationTime) } }}
        </span>
        @if (hour.filler_request_id !== undefined) {
          <a routerLink="/filler-reminders">{{ 'trackPlan.reminder' | translate }}</a>
        }
      </header>

      @if (view().warnings.length > 0) {
        <ul class="warnings" [attr.aria-label]="'trackPlan.warningsLabel' | translate">
          @for (warning of view().warnings; track $index) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      <div class="table-scroll">
        <table class="items">
          <thead>
            <tr>
              <th scope="col">{{ 'trackPlan.columns.start' | translate }}</th>
              <th scope="col">
                <span class="cdk-visually-hidden">{{
                  'trackPlan.columns.preview' | translate
                }}</span>
              </th>
              <th scope="col">{{ 'trackPlan.columns.title' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.artist' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.length' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.source' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.status' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of view().rows; track row.item.id) {
              @let item = row.item;
              <tr>
                <td class="time">{{ item.planned_start_utc | stationTime: 'time-seconds' }}</td>
                <td>
                  <app-play-button [track]="row.preview" />
                </td>
                <td>{{ item.title }}</td>
                <td>{{ item.artist_name }}</td>
                <td class="time">
                  {{ item.planned_out_ms | duration }}
                  @if (item.truncated) {
                    <span class="badge warn">
                      {{
                        'trackPlan.truncated' | translate: { length: (item.duration_ms | duration) }
                      }}
                    </span>
                  }
                </td>
                <td>{{ 'trackPlan.sources.' + item.source | translate }}</td>
                <td>
                  <span class="badge" [class.warn]="item.status === 'missed'">
                    {{ 'trackPlan.statuses.' + item.status | translate }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="muted" colspan="7">{{ 'trackPlan.noItems' | translate }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .hour {
      margin-bottom: 1.5rem;
    }

    .hour-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      align-items: baseline;
    }

    .hour-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .warnings {
      margin: 0.5rem 0;
      padding: 0.5rem 0.5rem 0.5rem 1.75rem;
      border-left: 4px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .items {
      width: 100%;
      border-collapse: collapse;
    }

    .items th,
    .items td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    .time {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class TrackPlanHourComponent {
  readonly view = input.required<PlanHourView>();

  protected headingId(): string {
    return `plan-hour-${Date.parse(this.view().hour.hour_start_utc)}`;
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ApiSchema } from '../../core/api/api-types';
import type { PreviewTrack } from '../../core/player/player.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe, PlannedLengthPipe } from '../../core/time/duration.pipe';
import { plannedLengthMs } from '../../core/time/duration';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';

type PlayoutStatus = ApiSchema<'PlayoutStatus'>;

export interface QueuedRow {
  item: ApiSchema<'PlayoutQueuedItem'>;
  preview: PreviewTrack;
}

/**
 * What is on air (backend phase-9 plan): now playing with its progress, the control link to
 * Liquidsoap, the Icecast output, and the items waiting in Liquidsoap's hour queues.
 * Presentational; the page keeps the status current from events.
 */
@Component({
  selector: 'app-on-air',
  imports: [
    MatProgressBarModule,
    TranslatePipe,
    DurationPipe,
    PlannedLengthPipe,
    StationTimePipe,
    PlayButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = status();
    <dl class="links">
      <dt>{{ 'live.onAir.controlLink' | translate }}</dt>
      <dd>
        <span class="badge" [class.warn]="!current.control_link.connected">
          {{
            (current.control_link.connected ? 'live.onAir.connected' : 'live.onAir.disconnected')
              | translate
          }}
        </span>
        @if (current.control_link.since; as since) {
          <span class="muted">
            {{
              'live.onAir.since' | translate: { time: (since | stationTime: 'datetime-seconds') }
            }}
          </span>
        }
      </dd>
      <dt>{{ 'live.onAir.output' | translate }}</dt>
      <dd>
        @if (current.output; as output) {
          <span class="badge" [class.warn]="output.state !== 'connected'">
            {{ 'live.onAir.' + output.state | translate }}
          </span>
          <span class="muted">
            {{
              'live.onAir.since'
                | translate: { time: (output.since | stationTime: 'datetime-seconds') }
            }}
          </span>
        } @else {
          <span class="muted">{{ 'live.onAir.unknown' | translate }}</span>
        }
      </dd>
    </dl>

    <h3 class="sub-title">{{ 'live.onAir.nowPlaying' | translate }}</h3>
    @if (current.now_playing; as now) {
      <div class="now">
        <p class="now-title">
          <strong>{{ now.title }}</strong>
          @if (now.artist_name) {
            — {{ now.artist_name }}
          }
          @if (now.source === 'emergency') {
            <span class="badge warn">{{ 'live.onAir.emergency' | translate }}</span>
          }
          @if (now.truncated) {
            <span class="badge">{{ 'live.onAir.truncated' | translate }}</span>
          }
        </p>
        <p class="muted">
          {{
            'live.onAir.started'
              | translate: { time: (now.started_at | stationTime: 'time-seconds') }
          }}
          @if (now.out_ms !== undefined) {
            · {{ elapsedMs() | duration }} / {{ now.out_ms | plannedLength: now.in_ms }}
          }
        </p>
        @if (progress() !== null) {
          <mat-progress-bar
            mode="determinate"
            [value]="progress() ?? 0"
            [attr.aria-label]="'live.onAir.progress' | translate"
          />
        }
      </div>
    } @else {
      <p class="muted">{{ 'live.onAir.nothing' | translate }}</p>
    }

    <h3 class="sub-title">{{ 'live.onAir.queued' | translate }}</h3>
    <div class="table-scroll">
      <table class="queued">
        <thead>
          <tr>
            <th scope="col">{{ 'trackPlan.columns.start' | translate }}</th>
            <th scope="col">
              <span class="cdk-visually-hidden">{{ 'trackPlan.columns.preview' | translate }}</span>
            </th>
            <th scope="col">{{ 'trackPlan.columns.title' | translate }}</th>
            <th scope="col">{{ 'trackPlan.columns.artist' | translate }}</th>
            <th scope="col">{{ 'trackPlan.columns.length' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of queued(); track row.item.id) {
            <tr>
              <td class="time">{{ row.item.planned_start_utc | stationTime: 'time-seconds' }}</td>
              <td><app-play-button [track]="row.preview" /></td>
              <td>{{ row.item.title }}</td>
              <td>{{ row.item.artist_name }}</td>
              <td class="time">
                {{ row.item.planned_out_ms | plannedLength: row.item.planned_in_ms }}
              </td>
            </tr>
          } @empty {
            <tr>
              <td class="muted" colspan="5">{{ 'live.onAir.queueEmpty' | translate }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .links {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      margin: 0 0 1rem;
    }

    .links dd {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0;
    }

    .sub-title {
      margin: 1rem 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .now-title {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin: 0;
    }

    .queued {
      width: 100%;
      border-collapse: collapse;
    }

    .queued th,
    .queued td {
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
export class OnAirComponent {
  readonly status = input.required<PlayoutStatus>();
  readonly queued = input.required<readonly QueuedRow[]>();
  /** The current time in ms, ticking once a second while the page is open. */
  readonly now = input.required<number>();

  protected readonly elapsedMs = computed(() => {
    const playing = this.status().now_playing;
    return playing ? Math.max(0, this.now() - Date.parse(playing.started_at)) : 0;
  });

  /** 0..100; null when the length is unknown. */
  protected readonly progress = computed(() => {
    const playing = this.status().now_playing;
    const length = playing ? plannedLengthMs(playing.in_ms, playing.out_ms) : undefined;
    return length ? Math.min(100, (this.elapsedMs() / length) * 100) : null;
  });
}

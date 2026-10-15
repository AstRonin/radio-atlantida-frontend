import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { stationToday } from '../../core/time/local-date';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { StationTimeService, TimeFormat, parseApiTime } from '../../core/time/station-time.service';

export type AirWindowRow = ApiSchema<'AirWindowRow'>;

interface ListRow {
  key: string;
  row: AirWindowRow;
  startFormat: TimeFormat;
  endFormat: TimeFormat;
}

/**
 * The air around now (backend phase-17 plan): the last items that were due, the item on air, and
 * the next items, in the backend's order. Presentational: the page loads the rows and passes the
 * server's current time, which ticks the progress of the now row.
 */
@Component({
  selector: 'app-air-window-list',
  imports: [
    NgTemplateOutlet,
    MatProgressBarModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    StationTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!controlLinkConnected()) {
      <p class="playout-unknown" role="status">{{ 'airWindow.playoutUnknown' | translate }}</p>
    }
    @if (listRows().length === 0) {
      <p class="muted empty">
        {{ 'airWindow.empty' | translate }}
        <a routerLink="/track-plan">{{ 'airWindow.trackPlanLink' | translate }}</a>
      </p>
    } @else {
      <div class="table-scroll">
        <table class="air-window" [attr.aria-label]="'airWindow.listLabel' | translate">
          <thead>
            <tr>
              <th scope="col">{{ 'airWindow.columns.start' | translate }}</th>
              <th scope="col">{{ 'airWindow.columns.end' | translate }}</th>
              <th scope="col">{{ 'airWindow.columns.status' | translate }}</th>
              <th scope="col">{{ 'airWindow.columns.artist' | translate }}</th>
              <th scope="col">{{ 'airWindow.columns.title' | translate }}</th>
              <th scope="col">{{ 'airWindow.columns.source' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (item of listRows(); track item.key; let index = $index) {
              @if (index === nothingOnAirAt()) {
                <ng-container [ngTemplateOutlet]="nothingOnAir" />
              }
              @let row = item.row;
              <tr
                [class.now]="row.kind === 'now'"
                [class.missed]="row.status === 'missed'"
                [class.queued]="row.kind === 'queued'"
              >
                <td class="time">{{ row.start_utc | stationTime: item.startFormat }}</td>
                <td class="time">{{ row.end_utc | stationTime: item.endFormat }}</td>
                <td>
                  <span class="badge" [class.warn]="row.status === 'missed'">
                    {{ statusKey(row) | translate }}
                  </span>
                  @if (row.status === 'missed' && row.resolution) {
                    <div class="detail">
                      <span>{{ 'airWindow.resolutions.' + row.resolution | translate }}</span>
                      @if (row.resolution === 'open') {
                        <a routerLink="/missed-items">{{ 'airWindow.resolve' | translate }}</a>
                      }
                    </div>
                  }
                  @if (row.kind === 'now') {
                    <div class="detail">
                      @if (row.truncated) {
                        <span>{{ 'airWindow.fade' | translate }}</span>
                      }
                      <span class="time">
                        {{ elapsedMs() | duration }}
                        @if (outMs(); as out) {
                          / {{ out | duration }}
                        }
                      </span>
                      @if (progress() !== null) {
                        <mat-progress-bar
                          mode="determinate"
                          [value]="progress() ?? 0"
                          [attr.aria-label]="'airWindow.progress' | translate"
                        />
                      }
                    </div>
                  }
                </td>
                <td>{{ row.artist_name }}</td>
                <td>{{ row.title }}</td>
                <td>{{ 'airWindow.sources.' + row.source | translate }}</td>
              </tr>
            }
            @if (nothingOnAirAt() === listRows().length) {
              <ng-container [ngTemplateOutlet]="nothingOnAir" />
            }
          </tbody>
        </table>
      </div>
    }

    <ng-template #nothingOnAir>
      <tr class="nothing-on-air">
        <td class="muted" colspan="6">{{ 'airWindow.nothingOnAir' | translate }}</td>
      </tr>
    </ng-template>
  `,
  styles: `
    .playout-unknown {
      margin: 0 0 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .empty {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .air-window {
      width: 100%;
      border-collapse: collapse;
    }

    .air-window th,
    .air-window td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      vertical-align: top;
    }

    .time {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .now {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .missed {
      background: color-mix(in srgb, var(--mat-sys-error-container) 40%, transparent);
    }

    .detail {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 8rem;
      margin-top: 0.125rem;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class AirWindowListComponent {
  private readonly time = inject(StationTimeService);

  /** In air order, as `GET /api/air-window` sends them. */
  readonly rows = input.required<readonly AirWindowRow[]>();
  /** False: Liquidsoap is not connected, so what is on air is unknown. */
  readonly controlLinkConnected = input.required<boolean>();
  /** The server's current time in ms, ticking once a second while the list is shown. */
  readonly now = input.required<number>();

  private readonly today = computed(() => stationToday(this.time.zone(), new Date(this.now())));

  protected readonly listRows = computed((): ListRow[] => {
    const zone = this.time.zone();
    const today = this.today();
    // A time of another station day carries its date, so a window across midnight reads right.
    const format = (value: string | null): TimeFormat =>
      value !== null && stationToday(zone, parseApiTime(value)) !== today
        ? 'datetime-seconds'
        : 'time-seconds';
    return this.rows().map((row) => ({
      key: `${row.kind}:${row.item_id ?? ''}:${row.start_utc}`,
      row,
      startFormat: format(row.start_utc),
      endFormat: format(row.end_utc),
    }));
  });

  private readonly nowRow = computed(() => this.rows().find((row) => row.kind === 'now') ?? null);

  /**
   * Where "Nothing on air" goes: before the first queued row, or after the last played one. Only
   * while connected, since without the control link a missing now row means unknown, not silence.
   */
  protected readonly nothingOnAirAt = computed((): number | null => {
    const rows = this.rows();
    if (!this.controlLinkConnected() || rows.length === 0 || this.nowRow()) {
      return null;
    }
    const firstQueued = rows.findIndex((row) => row.kind === 'queued');
    return firstQueued === -1 ? rows.length : firstQueued;
  });

  protected readonly elapsedMs = computed(() => {
    const row = this.nowRow();
    return row ? Math.max(0, this.now() - Date.parse(row.start_utc)) : 0;
  });

  protected readonly outMs = computed(() => {
    const row = this.nowRow();
    return row?.end_utc ? Math.max(0, Date.parse(row.end_utc) - Date.parse(row.start_utc)) : null;
  });

  /** 0..100, held at 100 past the end until an event reloads the list; null without a length. */
  protected readonly progress = computed(() => {
    const out = this.outMs();
    return out ? Math.min(100, (this.elapsedMs() / out) * 100) : null;
  });

  /** A queued row is "In Liquidsoap" once it is handed over, otherwise "Planned". */
  protected statusKey(row: AirWindowRow): string {
    const status = row.kind === 'queued' ? (row.in_liquidsoap ? 'queued' : 'planned') : row.status;
    return `airWindow.statuses.${status}`;
  }
}

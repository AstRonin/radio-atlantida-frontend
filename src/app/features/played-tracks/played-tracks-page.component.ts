import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { Subject, catchError, forkJoin, map, merge, of, switchMap } from 'rxjs';
import { ApiClient, ApiOperation } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { PreviewTrack } from '../../core/player/player.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { DurationPipe } from '../../core/time/duration.pipe';
import { addDays, stationMidnightUtc, stationToday } from '../../core/time/local-date';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { StationTimeService } from '../../core/time/station-time.service';
import { DateInputComponent } from '../../shared/forms/date-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { dateRangeValidator } from '../../shared/forms/validators';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import { OutageListComponent } from './outage-list.component';

type PlayHistoryEntry = ApiSchema<'PlayHistoryEntry'>;
type Outage = ApiSchema<'Outage'>;
type HistoryQuery = NonNullable<ApiOperation<'/api/play-history', 'get'>['parameters']['query']>;
type HistoryStatus = NonNullable<HistoryQuery['status']>;

/** The API reads at most 31 days of history and 7 days of outages at once. */
export const HISTORY_RANGE_MAX_DAYS = 31;
export const OUTAGE_CHUNK_MS = 7 * 86_400_000;
export const HISTORY_PAGE_SIZE = 100;

export const HISTORY_STATUSES: readonly HistoryStatus[] = ['aired', 'truncated', 'missed'];

interface HistoryRange {
  from: string;
  to: string;
}

interface HistoryRow {
  entry: PlayHistoryEntry;
  /** UTC; when it started, or for a missed item when it was planned to. */
  time: string | undefined;
  /** How long it played, or for a missed item how long it was planned to. */
  lengthMs: number | undefined;
  preview: PreviewTrack;
}

interface PageRequest {
  query: HistoryQuery;
  cursor?: string;
}

/** `GET /api/outages` takes at most 7 days, so a longer range is read in pieces. */
export function outageChunks(range: HistoryRange): HistoryRange[] {
  const end = Date.parse(range.to);
  const chunks: HistoryRange[] = [];
  for (let start = Date.parse(range.from); start < end; start += OUTAGE_CHUNK_MS) {
    chunks.push({
      from: new Date(start).toISOString(),
      to: new Date(Math.min(start + OUTAGE_CHUNK_MS, end)).toISOString(),
    });
  }
  return chunks;
}

/**
 * The played-tracks list (design §7.1): what aired, what was cut short, and what an outage kept off
 * the air, newest first, with the outages of the same range. Missed items are marked "Not aired"
 * and are resolved on the missed-items page. Aired rows arrive with every track, so the list is
 * refreshed on request; it reloads by itself only on the rare events that mark or resolve items.
 */
@Component({
  selector: 'app-played-tracks-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    StationTimePipe,
    DateInputComponent,
    FieldHintComponent,
    OutageListComponent,
    PageHeaderComponent,
    PlayButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="playedTracks.title" helpPage="help.played-tracks" />

    <section class="page-section" aria-labelledby="range-heading">
      <h2 id="range-heading" class="section-title">
        {{ 'playedTracks.range.title' | translate }}
      </h2>
      <p class="muted">{{ 'playedTracks.range.note' | translate: { zone: zone() } }}</p>
      <form class="range" [formGroup]="form" (ngSubmit)="refresh()">
        <app-date-input
          [control]="form.controls.from"
          label="playedTracks.fields.from"
          hintPage="help.played-tracks"
          hintField="from"
        />
        <app-date-input
          [control]="form.controls.to"
          label="playedTracks.fields.to"
          [min]="form.controls.from.value"
          [max]="maxTo()"
          hintPage="help.played-tracks"
          hintField="to"
        />
        <mat-form-field>
          <mat-label>{{ 'playedTracks.fields.status' | translate }}</mat-label>
          <mat-select [formControl]="form.controls.status">
            <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
            @for (status of statuses; track status) {
              <mat-option [value]="status">
                {{ 'playedTracks.statuses.' + status | translate }}
              </mat-option>
            }
          </mat-select>
          <app-field-hint matSuffix page="help.played-tracks" field="status" />
        </mat-form-field>
        <div class="form-actions">
          <button matButton type="button" (click)="showRecent()">
            {{ 'playedTracks.range.reset' | translate }}
          </button>
          <button matButton="filled" type="submit" [disabled]="!range()">
            {{ 'playedTracks.refresh' | translate }}
          </button>
        </div>
      </form>
    </section>

    <section class="page-section" aria-labelledby="history-heading">
      <h2 id="history-heading" class="section-title">
        {{ 'playedTracks.list.title' | translate }}
      </h2>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="refresh()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <div class="table-scroll">
        <table class="history">
          <thead>
            <tr>
              <th scope="col">{{ 'playedTracks.columns.time' | translate }}</th>
              <th scope="col">
                <span class="cdk-visually-hidden">{{
                  'playedTracks.columns.preview' | translate
                }}</span>
              </th>
              <th scope="col">{{ 'playedTracks.columns.title' | translate }}</th>
              <th scope="col">{{ 'playedTracks.columns.length' | translate }}</th>
              <th scope="col">{{ 'playedTracks.columns.clock' | translate }}</th>
              <th scope="col">{{ 'playedTracks.columns.source' | translate }}</th>
              <th scope="col">{{ 'playedTracks.columns.status' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.entry.id) {
              @let entry = row.entry;
              <tr [class.missed]="entry.status === 'missed'">
                <td class="time">{{ row.time | stationTime: 'datetime-seconds' }}</td>
                <td><app-play-button [track]="row.preview" /></td>
                <td>
                  {{ entry.title }}
                  @if (entry.artist_name) {
                    <span class="muted"> — {{ entry.artist_name }}</span>
                  }
                </td>
                <td class="time">{{ row.lengthMs | duration }}</td>
                <td>
                  @if (entry.clock; as clock) {
                    @if (clock.name) {
                      <a [routerLink]="['/clocks', clock.id]">{{ clock.name }}</a>
                    } @else {
                      <span class="muted">{{ 'playedTracks.deletedClock' | translate }}</span>
                    }
                  }
                </td>
                <td>{{ 'playedTracks.sources.' + entry.source | translate }}</td>
                <td>
                  <span class="badge" [class.warn]="entry.status === 'missed'">
                    {{ 'playedTracks.statuses.' + entry.status | translate }}
                  </span>
                  @if (entry.status === 'missed') {
                    <div class="missed-detail">
                      @if (entry.outage; as outage) {
                        <span>
                          {{ 'alerts.outage.components.' + outage.component | translate }}
                          @if (outage.reason) {
                            — {{ outage.reason }}
                          }
                        </span>
                      }
                      @if (entry.resolution === 'open') {
                        <a routerLink="/missed-items">{{ 'playedTracks.resolve' | translate }}</a>
                      } @else if (entry.resolution) {
                        <span class="muted">
                          {{
                            'missedItems.resolutions.' + entry.resolution
                              | translate: { time: (entry.resolved_at | stationTime) }
                          }}
                        </span>
                      }
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              @if (!loading() && !loadError() && range()) {
                <tr>
                  <td class="muted" colspan="7">{{ 'playedTracks.list.empty' | translate }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      @if (nextCursor()) {
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'common.loadMore' | translate }}
        </button>
      }
    </section>

    <section class="page-section" aria-labelledby="outages-heading">
      <h2 id="outages-heading" class="section-title">{{ 'outages.title' | translate }}</h2>
      @if (outages.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (outagesError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="outages.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      } @else if (outages.hasValue()) {
        <app-outage-list [outages]="outages.value()" />
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .range {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: baseline;
    }

    .history {
      width: 100%;
      border-collapse: collapse;
    }

    .history th,
    .history td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    .time {
      white-space: nowrap;
    }

    .missed {
      background: color-mix(in srgb, var(--mat-sys-error-container) 40%, transparent);
    }

    .missed-detail {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      font: var(--mat-sys-body-small);
      overflow-wrap: anywhere;
    }
  `,
})
export default class PlayedTracksPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);

  protected readonly zone = inject(StationTimeService).zone;
  protected readonly statuses = HISTORY_STATUSES;

  protected readonly form = new FormGroup(
    {
      from: new FormControl<string | null>(null, Validators.required),
      to: new FormControl<string | null>(null, Validators.required),
      status: new FormControl<HistoryStatus | null>(null),
    },
    { validators: dateRangeValidator('from', 'to', HISTORY_RANGE_MAX_DAYS) },
  );
  private readonly version = controlVersion(signal(this.form));

  protected readonly maxTo = computed(() => {
    this.version();
    const from = this.form.controls.from.value;
    return from ? addDays(from, HISTORY_RANGE_MAX_DAYS - 1) : null;
  });

  /** The range as UTC instants; null while the form is invalid. */
  protected readonly range = computed(
    (): HistoryRange | null => {
      this.version();
      const { from, to } = this.form.getRawValue();
      if (this.form.invalid || !from || !to) {
        return null;
      }
      const zone = this.zone();
      return {
        from: stationMidnightUtc(from, zone),
        to: stationMidnightUtc(addDays(to, 1), zone),
      };
    },
    { equal: (a, b) => a?.from === b?.from && a?.to === b?.to },
  );

  private readonly query = computed(
    (): HistoryQuery | null => {
      this.version();
      const range = this.range();
      const status = this.form.controls.status.value;
      return range ? { ...range, limit: HISTORY_PAGE_SIZE, ...(status ? { status } : {}) } : null;
    },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  private readonly entries = signal<readonly PlayHistoryEntry[]>([]);
  protected readonly rows = computed(() => this.entries().map(rowOf));
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  private readonly pages = new Subject<PageRequest | null>();

  protected readonly outages = rxResource({
    params: () => this.range() ?? undefined,
    stream: ({ params }) =>
      forkJoin(
        outageChunks(params).map((chunk) => this.api.get('/api/outages', { query: chunk })),
      ).pipe(map((lists) => mergeOutages(lists.map((list) => list.items ?? [])))),
  });
  protected readonly outagesError = computed(() =>
    this.outages.status() === 'error' ? errorMessage(this.outages.error(), this.i18n) : null,
  );

  constructor() {
    this.showRecent();
    this.pages
      .pipe(
        switchMap((request) => {
          if (!request) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.loadError.set(null);
          return this.api
            .get('/api/play-history', { query: { ...request.query, cursor: request.cursor } })
            .pipe(
              map((page) => ({ request, page, error: null as unknown })),
              catchError((error: unknown) => of({ request, page: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) {
          this.entries.set([]);
          this.nextCursor.set(null);
          return;
        }
        const { request, page, error } = result;
        if (!page) {
          this.loadError.set(errorMessage(error, this.i18n));
          return;
        }
        const items = page.items ?? [];
        this.entries.update((rows) => (request.cursor ? [...rows, ...items] : items));
        this.nextCursor.set(page.next_cursor ?? null);
      });

    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => this.pages.next(query ? { query } : null));

    const realtime = inject(RealtimeService);
    // Items are marked missed after an outage or a backend restart, and resolved by a reschedule.
    merge(
      realtime.on('missed_items.completed'),
      realtime.on('playout_reconcile.completed'),
      realtime.on('reschedule.completed'),
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());
    merge(realtime.on('broadcast_outage.started'), realtime.on('broadcast_outage.ended'))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.outages.reload());
  }

  /** Yesterday and today in the station zone. */
  protected showRecent(): void {
    const today = stationToday(this.zone());
    this.form.patchValue({ from: addDays(today, -1), to: today });
  }

  /** Reads the first page and the outages again. */
  protected refresh(): void {
    const query = this.query();
    if (!query) {
      this.form.markAllAsTouched();
      return;
    }
    this.pages.next({ query });
    this.outages.reload();
  }

  protected loadMore(): void {
    const query = this.query();
    const cursor = this.nextCursor();
    if (query && cursor) {
      this.pages.next({ query, cursor });
    }
  }
}

function rowOf(entry: PlayHistoryEntry): HistoryRow {
  const missed = entry.status === 'missed';
  return {
    entry,
    time: missed ? entry.planned_start_utc : (entry.started_at ?? entry.planned_start_utc),
    lengthMs: missed ? entry.planned_out_ms : (entry.actual_duration_ms ?? entry.planned_out_ms),
    preview: {
      id: entry.track_id,
      title: entry.title,
      artist: entry.artist_name ? { name: entry.artist_name } : undefined,
    },
  };
}

/** The chunks overlap at their edges, so an outage may come twice. */
function mergeOutages(lists: readonly (readonly Outage[])[]): Outage[] {
  const byId = new Map<number, Outage>();
  for (const outage of lists.flat()) {
    byId.set(outage.id, outage);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

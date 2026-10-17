import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { formatHourOffset } from '../../core/time/duration';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import type { Playlist } from './clock-form';

type ClockSample = ApiSchema<'ClockSample'>;
type SampleItem = ApiSchema<'ClockSampleItem'>;

interface SampleRow {
  item: SampleItem;
  start: string;
  source: string;
  isInsert: boolean;
}

/**
 * The sample hour the backend built on the save (design §6.0): every item with its start in the
 * hour, its length, the track, and where it came from. Shown as sent, never recomputed; after an
 * edit it is marked as the sample of the saved clock.
 */
@Component({
  selector: 'app-clock-sample',
  imports: [TranslatePipe, DurationPipe, StationTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">
      {{ 'clocks.sample.hour' | translate: { hour: (sample().hour_start_utc | stationTime) } }}
    </p>
    @if (stale()) {
      <p class="muted" role="status">{{ 'clocks.sample.stale' | translate }}</p>
    }
    @if (rows().length === 0) {
      <p class="muted">{{ 'clocks.sample.empty' | translate }}</p>
    } @else {
      <ol class="sample" [attr.aria-label]="'clocks.sample.title' | translate">
        @for (row of rows(); track $index) {
          <li class="item" [class.insert]="row.isInsert">
            <span class="start">{{ row.start }}</span>
            <span class="length">{{ row.item.length_ms | duration }}</span>
            <span class="track">
              <span class="title">{{ row.item.title }}</span>
              @if (row.item.artist) {
                <span class="muted"> · {{ row.item.artist }}</span>
              }
            </span>
            <span class="badge" [class.warn]="row.item.source === 'general'">{{ row.source }}</span>
            @if (row.item.truncated) {
              <span class="badge warn">{{ 'clocks.sample.truncated' | translate }}</span>
            }
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .sample {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .item {
      display: grid;
      grid-template-columns: 3.5rem 3.5rem minmax(0, 1fr) auto auto;
      gap: 0.5rem;
      align-items: center;
      min-height: 2.25rem;
      padding: 0 0.25rem;
    }

    .item + .item {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .item.insert {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .start,
    .length {
      font-variant-numeric: tabular-nums;
    }

    .track {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 600px) {
      .item {
        grid-template-columns: 3.5rem minmax(0, 1fr) auto;
      }

      .length {
        display: none;
      }
    }
  `,
})
export class ClockSampleComponent {
  private readonly i18n = inject(I18nService);

  readonly sample = input.required<ClockSample>();
  /** Playlists by ID, for the name of a fill or rule track's playlist. */
  readonly playlists = input<ReadonlyMap<number, Playlist>>(new Map());
  /** True when the form changed since the save that built the sample. */
  readonly stale = input(false);

  protected readonly rows = computed((): SampleRow[] =>
    this.sample().items.map((item) => ({
      item,
      start: formatHourOffset(item.offset_ms),
      source: this.sourceLabel(item),
      isInsert: item.source === 'insert' || item.source === 'hour_insert',
    })),
  );

  private sourceLabel(item: SampleItem): string {
    const source = this.i18n.translate(`clocks.sample.sources.${item.source}`);
    const playlist =
      item.playlist_id === undefined ? undefined : this.playlists().get(item.playlist_id);
    return playlist ? `${source}: ${playlist.name}` : source;
  }
}

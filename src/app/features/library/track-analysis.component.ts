import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import type { Track } from './track-form';
import { TrackQualityComponent } from './track-quality.component';

/**
 * What the last analysis read from a track's file (backend phase 11): format, measurements, and
 * each quality issue with what can be done about it. Read-only; the values are the backend's.
 */
@Component({
  selector: 'app-track-analysis',
  imports: [TranslatePipe, StationTimePipe, TrackQualityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="facts">
      <dt>{{ 'library.fields.format' | translate }}</dt>
      <dd>
        {{ track().format ?? '–' }}
        @if (track().codec; as codec) {
          ({{ codec }})
        }
      </dd>
      <dt>{{ 'library.fields.bitrate' | translate }}</dt>
      <dd>{{ kbps(track().bitrate) }}</dd>
      @if (track().source_bitrate; as source) {
        <dt>{{ 'library.analysis.source_bitrate' | translate }}</dt>
        <dd>{{ kbps(source) }}</dd>
      }
      <dt>{{ 'library.fields.sample_rate' | translate }}</dt>
      <dd>
        @if (track().sample_rate; as hz) {
          {{ 'library.edit.hz' | translate: { hz } }}
        } @else {
          –
        }
      </dd>
      <dt>{{ 'library.analysis.channels' | translate }}</dt>
      <dd>{{ track().channels ?? '–' }}</dd>
      <dt>{{ 'library.analysis.loudness_lufs' | translate }}</dt>
      <dd>{{ measure(track().loudness_lufs, 'library.analysis.lufs') }}</dd>
      <dt>{{ 'library.analysis.true_peak_dbtp' | translate }}</dt>
      <dd>{{ measure(track().true_peak_dbtp, 'library.analysis.dbtp') }}</dd>
      <dt>{{ 'library.analysis.loudness_range_lu' | translate }}</dt>
      <dd>{{ measure(track().loudness_range_lu, 'library.analysis.lu') }}</dd>
      <dt>{{ 'library.analysis.analyzed_at' | translate }}</dt>
      <dd>
        @if (track().analyzed_at; as at) {
          <time [attr.datetime]="at">{{ at | stationTime }}</time>
        } @else {
          {{ 'library.quality.unanalysed' | translate }}
        }
      </dd>
      <dt>{{ 'library.fields.quality_ok' | translate }}</dt>
      <dd><app-track-quality [track]="track()" /></dd>
    </dl>
    @if (track().quality_issues.length > 0) {
      <ul class="issues">
        @for (issue of track().quality_issues; track issue) {
          <li>
            <strong>{{ 'library.quality.issueNames.' + issue | translate }}</strong
            >: {{ 'library.quality.explain.' + issue | translate }}
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      margin: 0;
    }

    .facts dt {
      color: var(--mat-sys-on-surface-variant);
    }

    .facts dd {
      margin: 0;
    }

    .issues {
      margin: 0.75rem 0 0;
      padding-left: 1.25rem;
    }
  `,
})
export class TrackAnalysisComponent {
  private readonly i18n = inject(I18nService);

  readonly track = input.required<Track>();

  private readonly decimal = computed(
    () => new Intl.NumberFormat(this.i18n.locale(), { maximumFractionDigits: 1 }),
  );

  protected kbps(bitsPerSecond: number | undefined): string {
    return bitsPerSecond
      ? this.i18n.translate('library.edit.kbps', { kbps: Math.round(bitsPerSecond / 1000) })
      : '–';
  }

  protected measure(value: number | undefined, unitKey: string): string {
    return value === undefined
      ? '–'
      : this.i18n.translate(unitKey, { value: this.decimal().format(value) });
  }
}

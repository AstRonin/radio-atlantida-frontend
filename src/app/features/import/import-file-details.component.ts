import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import type { FileRow } from './import-file-row';

type ImportFileInfo = ApiSchema<'ImportFileInfo'>;

/** A note under the title or artist of a probed file: a translation key and its parameters. */
interface SourceNote {
  key: string;
  params?: Record<string, string>;
}

/**
 * Where the title or artist an import would give comes from. A tag replaces the file name's value
 * at import, so that value is named when it differs from the tag.
 */
function sourceNoteOf(
  source: ImportFileInfo['title_source'] | ImportFileInfo['artist_source'],
  value: string | null,
  fromName: string | null,
): SourceNote {
  switch (source) {
    case 'tag':
      if (fromName === null || fromName === '') {
        return { key: 'import.folder.details.fromTagNoName' };
      }
      return fromName === value
        ? { key: 'import.folder.details.fromTagSame' }
        : { key: 'import.folder.details.fromTagReplaces', params: { name: fromName } };
    case 'file_name':
      return { key: 'import.folder.details.fromFileName' };
    case 'none':
      return { key: 'import.folder.details.noArtist' };
  }
}

/**
 * The detail row of one file on the Import page. A library file shows its track as the library has
 * it (for an original, the optimised copy); a new file shows the probe its row read: the technical
 * facts, the title and artist an import would give it and where they come from, and the issues
 * the probe shows. Presentational: the page reads the probe and passes the row.
 */
@Component({
  selector: 'app-import-file-details',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    StationTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let file = row().file;
    @if (file.track; as track) {
      @if (file.status === 'original') {
        <p class="muted">{{ 'import.folder.details.originalNote' | translate }}</p>
      }
      <dl class="facts">
        <dt>{{ 'library.fields.format' | translate }}</dt>
        <dd>{{ formatOf(track.format, track.codec) }}</dd>
        <dt>{{ 'library.fields.bitrate' | translate }}</dt>
        <dd>{{ kbps(track.bitrate) }}</dd>
        <dt>{{ 'library.fields.sample_rate' | translate }}</dt>
        <dd>{{ hz(track.sample_rate) }}</dd>
        <dt>{{ 'library.analysis.channels' | translate }}</dt>
        <dd>{{ track.channels ?? '–' }}</dd>
        <dt>{{ 'import.folder.details.issues' | translate }}</dt>
        <dd>{{ issueNames(track.quality_issues) }}</dd>
        <dt>{{ 'library.fields.reviewed' | translate }}</dt>
        <dd>
          @if (track.reviewed_at; as at) {
            <time [attr.datetime]="at">{{ at | stationTime }}</time>
          } @else {
            {{ 'import.folder.details.notReviewed' | translate }}
          }
        </dd>
      </dl>
      <p class="links">
        <a [routerLink]="['/library', track.id]">{{
          'import.folder.details.openTrack' | translate
        }}</a>
      </p>
    } @else if (file.status === 'new') {
      @let probe = row().probe;
      @switch (probe?.status) {
        @case ('ready') {
          @if (info(); as info) {
            <dl class="facts">
              <dt>{{ 'import.folder.columns.title' | translate }}</dt>
              <dd>
                {{ info.title }}
                @if (titleNote(); as note) {
                  <span class="note">{{ note.key | translate: note.params }}</span>
                }
              </dd>
              <dt>{{ 'import.folder.columns.artist' | translate }}</dt>
              <dd>
                {{ info.artist ?? '–' }}
                @if (artistNote(); as note) {
                  <span class="note">{{ note.key | translate: note.params }}</span>
                }
                @if (formArtist(); as name) {
                  <span class="note">{{
                    'import.folder.details.formArtist' | translate: { name }
                  }}</span>
                }
              </dd>
              <dt>{{ 'import.folder.columns.duration' | translate }}</dt>
              <dd>{{ info.duration_ms | duration }}</dd>
              <dt>{{ 'library.fields.format' | translate }}</dt>
              <dd>{{ formatOf(info.format, info.codec) }}</dd>
              <dt>{{ 'library.fields.bitrate' | translate }}</dt>
              <dd>{{ kbps(info.bitrate) }}</dd>
              <dt>{{ 'library.fields.sample_rate' | translate }}</dt>
              <dd>{{ hz(info.sample_rate) }}</dd>
              <dt>{{ 'library.analysis.channels' | translate }}</dt>
              <dd>{{ info.channels ?? '–' }}</dd>
              <dt>{{ 'import.folder.details.issues' | translate }}</dt>
              <dd>
                @if (info.issues.length === 0) {
                  {{ 'import.folder.details.noProbeIssues' | translate }}
                } @else {
                  <ul class="issues">
                    @for (issue of info.issues; track issue) {
                      <li>
                        <strong>{{ 'library.quality.issueNames.' + issue | translate }}</strong
                        >: {{ 'library.quality.explain.' + issue | translate }}
                      </li>
                    }
                  </ul>
                }
              </dd>
            </dl>
          }
        }
        @case ('error') {
          <p class="load-error" role="alert">
            {{ errorText() }}
            <button matButton type="button" (click)="retry.emit()">
              {{ 'common.retry' | translate }}
            </button>
          </p>
        }
        @default {
          <mat-progress-bar
            mode="indeterminate"
            [attr.aria-label]="'import.folder.details.loading' | translate"
          />
          <p class="muted" role="status">{{ 'import.folder.details.loading' | translate }}</p>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 0.5rem 0 1rem;
    }

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
      overflow-wrap: anywhere;
    }

    .note {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .issues {
      margin: 0;
      padding-left: 1.25rem;
    }

    .links {
      margin: 0.5rem 0 0;
    }

    p.muted {
      margin: 0 0 0.5rem;
    }
  `,
})
export class ImportFileDetailsComponent {
  private readonly i18n = inject(I18nService);

  readonly row = input.required<FileRow>();
  /** The artist chosen in the import form, which replaces the file's own at import. */
  readonly formArtist = input<string | null>(null);
  readonly retry = output();

  protected readonly info = computed(() => {
    const probe = this.row().probe;
    return probe?.status === 'ready' ? probe.info : null;
  });
  protected readonly errorText = computed(() => {
    const probe = this.row().probe;
    return probe?.status === 'error' ? probe.message : '';
  });
  protected readonly titleNote = computed(() => {
    const info = this.info();
    return info && sourceNoteOf(info.title_source, info.title, this.row().file.name_title ?? null);
  });
  protected readonly artistNote = computed(() => {
    const info = this.info();
    return (
      info && sourceNoteOf(info.artist_source, info.artist, this.row().file.name_artist ?? null)
    );
  });

  protected formatOf(format: string | null, codec: string | null): string {
    if (format === null) {
      return codec ?? '–';
    }
    return codec === null ? format : `${format} (${codec})`;
  }

  protected kbps(bitsPerSecond: number | null): string {
    return bitsPerSecond
      ? this.i18n.translate('library.edit.kbps', { kbps: Math.round(bitsPerSecond / 1000) })
      : '–';
  }

  protected hz(hz: number | null): string {
    return hz ? this.i18n.translate('library.edit.hz', { hz }) : '–';
  }

  protected issueNames(issues: readonly string[]): string {
    return issues.length === 0
      ? this.i18n.translate('import.folder.details.noIssues')
      : issues
          .map((issue) => this.i18n.translate(`library.quality.issueNames.${issue}`))
          .join(', ');
  }
}

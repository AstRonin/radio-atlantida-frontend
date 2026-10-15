import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { Track } from './track-form';

/**
 * The quality flag of a track, read-only: not analysed yet, no issues, or the issues the last
 * analysis found. Analysis and fixes come with the import phase.
 */
@Component({
  selector: 'app-track-quality',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('unanalysed') {
        <span class="badge">{{ 'library.quality.unanalysed' | translate }}</span>
      }
      @case ('ok') {
        <span class="badge">{{ 'library.quality.ok' | translate }}</span>
      }
      @case ('issues') {
        <span class="badge warn" [attr.title]="issues()">
          {{ 'library.quality.issues' | translate }}
        </span>
        @if (detailed()) {
          <span class="issues">{{ issues() }}</span>
        }
      }
    }
  `,
  styles: `
    .issues {
      margin-left: 0.5rem;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class TrackQualityComponent {
  private readonly i18n = inject(I18nService);

  readonly track = input.required<Pick<Track, 'quality_ok' | 'quality_issues'>>();
  /** Lists the issues as text next to the badge, instead of only in its tooltip. */
  readonly detailed = input(false);

  protected readonly state = computed(() => {
    const ok = this.track().quality_ok;
    return ok === undefined ? 'unanalysed' : ok ? 'ok' : 'issues';
  });

  protected readonly issues = computed(() =>
    this.track()
      .quality_issues.map((issue) => this.i18n.translate(`library.quality.issueNames.${issue}`))
      .join(', '),
  );
}

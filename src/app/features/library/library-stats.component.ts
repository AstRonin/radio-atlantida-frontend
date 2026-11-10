import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatInterval } from '../../shared/forms/interval-input.component';

export type TrackStats = ApiSchema<'TrackStats'>;

/** The filter a clicked figure stands for. */
export type LibraryStatsFilter = 'reviewed' | 'issues' | 'unanalysed';

interface Figure {
  label: string;
  value: string;
  filter?: LibraryStatsFilter;
}

/**
 * The figures of the listed tracks. Data comes in through an input, so the row can move to another
 * page unchanged. Without figures it shows dashes and nothing to click. It is not a live region:
 * the figures change often, and the page already announces its status.
 */
@Component({
  selector: 'app-library-stats',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="stats">
      @for (figure of figures(); track figure.label) {
        <div class="figure">
          <dt>{{ figure.label | translate }}</dt>
          <dd>
            @if (figure.filter; as chosen) {
              <button
                type="button"
                class="value-button"
                [attr.aria-label]="
                  'library.stats.apply'
                    | translate: { label: (figure.label | translate), value: figure.value }
                "
                (click)="filterChosen.emit(chosen)"
              >
                {{ figure.value }}
              </button>
            } @else {
              {{ figure.value }}
            }
          </dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host {
      display: block;
    }

    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1.5rem;
      margin: 0 0 0.75rem;
    }

    .figure {
      display: flex;
      align-items: baseline;
      gap: 0.375rem;
    }

    dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    dd {
      margin: 0;
      font: var(--mat-sys-title-small);
      font-variant-numeric: tabular-nums;
    }

    /* Applies a filter from inside a line of text, so it is a button that reads as a link. */
    .value-button {
      padding: 0;
      border: 0;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      font-variant-numeric: inherit;
      text-decoration: underline;
      cursor: pointer;
    }

    .value-button:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
  `,
})
export class LibraryStatsComponent {
  private readonly i18n = inject(I18nService);

  /** Null before the first answer and after a failed request. */
  readonly stats = input.required<TrackStats | null>();
  readonly filterChosen = output<LibraryStatsFilter>();

  protected readonly figures = computed((): readonly Figure[] => {
    const stats = this.stats();
    const unknown = this.i18n.translate('library.stats.unknown');
    const numbers = new Intl.NumberFormat(this.i18n.locale());
    const count = (
      key: Exclude<keyof TrackStats, 'air_duration_ms'>,
      label: string,
      filter?: LibraryStatsFilter,
    ): Figure =>
      stats ? { label, value: numbers.format(stats[key]), filter } : { label, value: unknown };
    return [
      count('total', 'library.stats.tracks'),
      count('reviewed', 'library.stats.reviewed', 'reviewed'),
      count('with_issues', 'library.stats.withIssues', 'issues'),
      count('unanalysed', 'library.stats.notAnalysed', 'unanalysed'),
      {
        label: 'library.stats.airTime',
        value: stats
          ? formatInterval(this.i18n, Math.round(stats.air_duration_ms / 60_000))
          : unknown,
      },
    ];
  });
}

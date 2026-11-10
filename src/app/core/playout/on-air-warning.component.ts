import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { OnAirWarningService } from './on-air-warning.service';

/**
 * The header's warning that the air is not the plan. The live region stays in the page while it
 * is empty, because a screen reader announces only changes inside a region that already exists.
 * Only CSS truncates the title, so a screen reader and the tooltip have all of it.
 */
@Component({
  selector: 'app-on-air-warning',
  imports: [MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="region"
      role="status"
      aria-live="polite"
      [attr.aria-label]="'onAirWarning.label' | translate"
    >
      @if (warning(); as current) {
        <span class="warning" [class]="current.kind" tabindex="0" [matTooltip]="text()">
          <span class="icon" aria-hidden="true">⚠</span>
          <span class="text">{{ text() }}</span>
        </span>
      }
    </span>
  `,
  styles: `
    :host {
      display: contents;
    }

    .region {
      display: inline-flex;
      min-width: 0;
      max-width: min(24rem, 40vw);
    }

    /* Out of the toolbar's flow while empty, so it adds no gap. */
    .region:empty {
      position: absolute;
    }

    .warning {
      display: inline-flex;
      gap: 0.35rem;
      align-items: center;
      min-width: 0;
      padding: 0.125rem 0.5rem;
      border: 1px solid transparent;
      border-radius: 4px;
      font: var(--mat-sys-label-large);
    }

    .safety {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .emergency {
      border-color: var(--app-status-warning);
      background: color-mix(in srgb, var(--app-status-warning) 25%, transparent);
      color: var(--mat-sys-on-surface);
    }

    .text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class OnAirWarningComponent {
  private readonly i18n = inject(I18nService);

  protected readonly warning = inject(OnAirWarningService).warning;

  protected readonly text = computed(() => {
    const warning = this.warning();
    if (!warning) {
      return '';
    }
    return warning.kind === 'safety'
      ? this.i18n.translate('onAirWarning.safety')
      : this.i18n.translate('onAirWarning.emergency', { title: warning.title });
  });
}

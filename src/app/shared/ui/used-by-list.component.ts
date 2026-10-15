import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { EntityRef } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * The entities that block a delete, from the problem's `used_by` (design §6.2), for example the
 * clocks that use a playlist.
 */
@Component({
  selector: 'app-used-by-list',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 0) {
      <p class="intro">{{ 'dialogs.usedBy.intro' | translate }}</p>
      <ul class="items">
        @for (item of items(); track item.kind + item.id) {
          <li>
            <span class="kind">{{ kindLabel(item.kind) }}:</span> {{ item.name }}
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .intro {
      margin: 0.5rem 0 0.25rem;
    }

    .items {
      max-height: 12rem;
      margin: 0;
      padding-left: 1.25rem;
      overflow-y: auto;
    }

    .kind {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class UsedByListComponent {
  private readonly i18n = inject(I18nService);

  readonly items = input.required<readonly EntityRef[]>();

  // Kinds come from the backend; one this build has no text for is shown as sent.
  protected kindLabel(kind: string): string {
    const key = `dialogs.usedBy.kinds.${kind}`;
    return this.i18n.has(key) ? this.i18n.translate(key) : kind;
  }
}

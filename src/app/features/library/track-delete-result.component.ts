import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { BulkDeleteResult } from './track-bulk-delete';

/** Refusals listed by name; the rest stay selected and are only counted. */
export const REFUSALS_SHOWN = 20;

/** The outcome of a bulk delete: how many tracks went, and why the others were kept. */
@Component({
  selector: 'app-track-delete-result',
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p role="status">
      {{
        'library.bulkDelete.done'
          | translate: { deleted: result().deleted.length, requested: result().requested }
      }}
    </p>
    @if (result().refused.length > 0) {
      <h3 class="refused-title" role="alert">
        {{ 'library.bulkDelete.refusedTitle' | translate: { count: result().refused.length } }}
      </h3>
      <ul class="refused">
        @for (refusal of shown(); track refusal.track_id) {
          <li>
            <span class="track">{{ refusal.title || '#' + refusal.track_id }}</span
            >:
            {{ 'problems.' + refusal.code | translate }}
            @if (refusal.used_by?.length) {
              {{ 'library.bulkDelete.usedBy' | translate }}
              @for (item of refusal.used_by; track item.kind + item.id) {
                @if (item.kind === 'clock') {
                  <a class="ref" [routerLink]="['/clocks', item.id]">{{ item.name }}</a>
                } @else {
                  <span class="ref">{{ item.name }}</span>
                }
              }
            }
          </li>
        }
      </ul>
      @if (hidden() > 0) {
        <p class="muted">{{ 'library.bulkDelete.moreRefused' | translate: { count: hidden() } }}</p>
      }
    }
  `,
  styles: `
    p {
      margin: 0.5rem 0 0;
    }

    .refused-title {
      margin: 0.75rem 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .refused {
      margin: 0;
      padding-left: 1.25rem;
    }

    .track {
      font-weight: 500;
    }

    .ref:not(:last-child)::after {
      content: ',';
    }
  `,
})
export class TrackDeleteResultComponent {
  readonly result = input.required<BulkDeleteResult>();

  protected readonly shown = computed(() => this.result().refused.slice(0, REFUSALS_SHOWN));
  protected readonly hidden = computed(() => this.result().refused.length - REFUSALS_SHOWN);
}

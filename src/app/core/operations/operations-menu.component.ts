import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { StationTimePipe } from '../time/station-time.pipe';
import { OperationState, OperationsService } from './operations.service';

/**
 * Header list of recent backend operations, including the ones the scheduler started. It shows
 * each terminal event as it arrives, and the outcomes read after a reconnect.
 */
@Component({
  selector: 'app-operations-menu',
  imports: [MatButtonModule, MatMenuModule, TranslatePipe, StationTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button matButton type="button" [matMenuTriggerFor]="menu">
      {{ 'operations.button' | translate: { count: operations.activeCount() } }}
    </button>
    <mat-menu #menu="matMenu" class="operations-menu" xPosition="before">
      @for (operation of operations.operations(); track operation.id) {
        <div mat-menu-item class="operation" [class]="operation.status">
          <span class="line">
            <span class="kind">{{ kindLabel(operation) }}</span>
            <span class="status">{{ 'operations.status.' + operation.status | translate }}</span>
          </span>
          <span class="detail">
            @if (operation.updatedAt) {
              <time [attr.datetime]="operation.updatedAt">{{
                operation.updatedAt | stationTime: 'time'
              }}</time>
            }
            @if (operation.status === 'failed') {
              {{ operation.error }}
            } @else if (operation.status === 'completed') {
              {{ operation.summary }}
            } @else if (operation.progress; as progress) {
              {{
                progress.message ||
                  ('operations.progress'
                    | translate: { done: progress.done, total: progress.total })
              }}
            }
          </span>
        </div>
      } @empty {
        <p class="empty">{{ 'operations.empty' | translate }}</p>
      }
    </mat-menu>
  `,
  styles: `
    .operation {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      height: auto;
      min-height: 3.5rem;
      padding-block: 0.5rem;
      cursor: default;
    }

    .line {
      display: flex;
      gap: 1rem;
      justify-content: space-between;
    }

    .kind {
      font: var(--mat-sys-title-small);
    }

    .status,
    .detail {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .detail {
      display: flex;
      gap: 0.5rem;
      white-space: normal;
    }

    .failed .status,
    .failed .detail {
      color: var(--mat-sys-error);
    }

    .empty {
      margin: 0.75rem 1rem;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class OperationsMenuComponent {
  private readonly i18n = inject(I18nService);
  protected readonly operations = inject(OperationsService);

  // Kinds come from the backend; one this build has no text for is shown as sent.
  protected kindLabel(operation: OperationState): string {
    if (operation.kind === null) {
      return this.i18n.translate('operations.kinds.unknown', { id: operation.id });
    }
    const key = `operations.kinds.${operation.kind}`;
    return this.i18n.has(key) ? this.i18n.translate(key) : operation.kind;
  }
}

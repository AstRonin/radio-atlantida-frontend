import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { OperationState } from '../../core/operations/operations.service';

/**
 * The status line of an operation a page started (design §6.5): a progress bar and the backend's
 * progress message while it runs, its summary when it completes. A failure is only named here;
 * the reason already arrived as an `error.alert` popup.
 */
@Component({
  selector: 'app-operation-status',
  imports: [MatProgressBarModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as current) {
      <div class="operation-status" [class]="current.status" role="status">
        @switch (current.status) {
          @case ('completed') {
            <p>
              {{ 'operationStatus.completed' | translate }}
              @if (current.summary) {
                {{ current.summary }}
              }
            </p>
          }
          @case ('failed') {
            <p class="form-error">{{ 'operationStatus.failed' | translate }}</p>
          }
          @default {
            @if (percent(); as value) {
              <mat-progress-bar
                mode="determinate"
                [value]="value"
                [attr.aria-label]="runningLabel() | translate"
              />
            } @else {
              <mat-progress-bar
                mode="indeterminate"
                [attr.aria-label]="runningLabel() | translate"
              />
            }
            <p class="muted">
              {{ runningLabel() | translate }}
              @if (current.progress; as progress) {
                {{
                  progress.message ||
                    ('operations.progress'
                      | translate: { done: progress.done, total: progress.total })
                }}
              }
            </p>
          }
        }
      </div>
    }
  `,
  styles: `
    .operation-status p {
      margin: 0.5rem 0 0;
    }
  `,
})
export class OperationStatusComponent {
  readonly state = input.required<OperationState | null>();
  /** Translation key of the line while the operation runs, for example "Importing…". */
  readonly runningLabel = input('operationStatus.running');

  /** Null while the total is unknown: the bar then runs without a value. */
  protected readonly percent = computed(() => {
    const progress = this.state()?.progress;
    return progress && progress.total > 0
      ? Math.max(1, Math.round((100 * progress.done) / progress.total))
      : null;
  });
}

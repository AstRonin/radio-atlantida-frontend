import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { ApiProblem } from '../../core/api/api-problem';
import type { EntityRef } from '../../core/api/api-types';
import { problemMessage } from '../../core/api/problem-message';
import { I18nService, TranslationParams } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { UsedByListComponent } from './used-by-list.component';

export interface ConfirmDialogData {
  /** Translation keys and their parameters. */
  title: string;
  message: string;
  params?: TranslationParams;
  confirmLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  /**
   * Runs on confirm, while the dialog stays open. A refusal is shown in the dialog with the
   * entities that block it (`used_by`), instead of closing it.
   */
  action?: () => Observable<unknown>;
}

/**
 * A generic confirmation, mainly for deletes. The dialog closes with `true` once confirmed and,
 * with an action, once the action succeeded; with `false` or nothing otherwise.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule, TranslatePipe, UsedByListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title | translate: data.params }}</h2>
    <mat-dialog-content>
      @if (refusal()) {
        <p class="refusal" role="alert">{{ refusalMessage() }}</p>
        <app-used-by-list [items]="usedBy()" />
      } @else {
        <p>{{ data.message | translate: data.params }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (refusal()) {
        <button matButton="filled" type="button" [mat-dialog-close]="false">
          {{ 'common.close' | translate }}
        </button>
      } @else {
        <button matButton type="button" [disabled]="busy()" [mat-dialog-close]="false">
          {{ 'common.cancel' | translate }}
        </button>
        <button
          matButton="filled"
          type="button"
          [class.destructive]="data.destructive"
          [disabled]="busy()"
          (click)="confirm()"
        >
          {{ data.confirmLabel ?? 'common.confirm' | translate }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .refusal {
      color: var(--mat-sys-error);
    }

    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialogComponent {
  private readonly i18n = inject(I18nService);
  private readonly dialogRef = inject<MatDialogRef<ConfirmDialogComponent, boolean>>(MatDialogRef);
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly refusal = signal<unknown>(null);
  protected readonly refusalMessage = signal('');
  protected readonly usedBy = signal<readonly EntityRef[]>([]);

  protected confirm(): void {
    const action = this.data.action;
    if (!action) {
      this.dialogRef.close(true);
      return;
    }
    this.busy.set(true);
    // While the action runs, Escape and the backdrop must not close the dialog and lose its result.
    this.dialogRef.disableClose = true;
    action().subscribe({
      complete: () => this.dialogRef.close(true),
      error: (error: unknown) => {
        this.busy.set(false);
        this.dialogRef.disableClose = false;
        this.refusal.set(error);
        if (error instanceof ApiProblem) {
          this.refusalMessage.set(problemMessage(error, this.i18n));
          this.usedBy.set(error.used_by);
        } else {
          this.refusalMessage.set(this.i18n.translate('alerts.panelError'));
        }
      },
    });
  }
}

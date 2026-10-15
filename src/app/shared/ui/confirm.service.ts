import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

export interface DeleteOptions {
  /** The name of the item, shown in the question. */
  name: string;
  /** The delete request; a refusal stays in the dialog with its `used_by` list. */
  action: () => Observable<unknown>;
  /** Translation keys; the defaults ask "Delete {name}?". */
  title?: string;
  message?: string;
}

/** Opens the confirm dialog. Emits once: true when confirmed (and the action succeeded). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  confirm(data: ConfirmDialogData): Observable<boolean> {
    return this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        data,
        role: 'alertdialog',
        width: '32rem',
        maxWidth: 'calc(100vw - 2rem)',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .pipe(map((result) => result === true));
  }

  confirmDelete(options: DeleteOptions): Observable<boolean> {
    return this.confirm({
      title: options.title ?? 'dialogs.delete.title',
      message: options.message ?? 'dialogs.delete.message',
      params: { name: options.name },
      confirmLabel: 'common.delete',
      destructive: true,
      action: options.action,
    });
  }
}

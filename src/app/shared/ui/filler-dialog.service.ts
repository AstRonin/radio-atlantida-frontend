import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Observable, filter } from 'rxjs';
import {
  FillerDialogComponent,
  FillerDialogData,
  FillerDialogResult,
} from './filler-dialog.component';

/** Dialog options of the blocking filler dialog; exported for the test of its rules. */
export const FILLER_DIALOG_CONFIG: MatDialogConfig = {
  // Design §6.2: never closed by a click outside or Escape, only by a choice or "save incomplete".
  disableClose: true,
  role: 'alertdialog',
  width: '40rem',
  maxWidth: 'calc(100vw - 2rem)',
  autoFocus: 'first-tabbable',
};

@Injectable({ providedIn: 'root' })
export class FillerDialogService {
  private readonly dialog = inject(MatDialog);

  /** Opens the dialog after a clock save that asks for a filler choice (design §6.0). */
  open(data: FillerDialogData): Observable<FillerDialogResult> {
    return this.dialog
      .open<FillerDialogComponent, FillerDialogData, FillerDialogResult>(FillerDialogComponent, {
        ...FILLER_DIALOG_CONFIG,
        data,
      })
      .afterClosed()
      .pipe(filter((result): result is FillerDialogResult => result !== undefined));
  }
}

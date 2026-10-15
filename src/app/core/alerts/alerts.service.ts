import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ApiProblem } from '../api/api-problem';
import { problemMessage } from '../api/problem-message';
import { I18nService } from '../i18n/i18n.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ErrorAlertDialogComponent, ErrorAlertDialogData } from './error-alert-dialog.component';

export interface Alert {
  id: number;
  /** UTC instant, shown in the station timezone. */
  time: string;
  message: string;
  error?: string;
  component?: string;
  requestId?: string;
}

/** Alerts kept while the dialog is open; a burst of errors cannot grow it without limit. */
export const ALERTS_KEPT = 50;

/**
 * Error popups (design §6, §10.1). Every `error.alert` event, and every error the panel itself did
 * not handle, is added to one dialog, newest first, so a burst of errors is one popup and not a
 * stack of them. Closing the dialog clears the list.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);

  private readonly current = signal<readonly Alert[]>([]);
  private dialogRef: MatDialogRef<ErrorAlertDialogComponent> | null = null;
  private nextId = 1;

  readonly alerts = this.current.asReadonly();

  constructor() {
    inject(RealtimeService)
      .on('error.alert')
      .pipe(takeUntilDestroyed())
      .subscribe((event) =>
        this.show({
          time: event.time,
          message: event.data.message,
          error: event.data.error,
          component: event.data.component,
          requestId: event.data.request_id,
        }),
      );
  }

  /** Shows an error the panel did not handle (see GlobalErrorHandler). */
  showPanelError(error: unknown): void {
    this.show({
      time: new Date().toISOString(),
      message: this.i18n.translate('alerts.panelError'),
      error: describe(error, this.i18n),
      requestId: error instanceof ApiProblem ? error.request_id : undefined,
    });
  }

  show(alert: Omit<Alert, 'id'>): void {
    this.current.update((alerts) =>
      [{ ...alert, id: this.nextId++ }, ...alerts].slice(0, ALERTS_KEPT),
    );
    if (this.dialogRef) {
      return;
    }
    this.dialogRef = this.dialog.open<ErrorAlertDialogComponent, ErrorAlertDialogData>(
      ErrorAlertDialogComponent,
      {
        data: { alerts: this.alerts },
        role: 'alertdialog',
        width: '36rem',
        maxWidth: 'calc(100vw - 2rem)',
        autoFocus: 'dialog',
      },
    );
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = null;
      this.current.set([]);
    });
  }
}

function describe(error: unknown, i18n: I18nService): string | undefined {
  if (error instanceof ApiProblem) {
    return problemMessage(error, i18n);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : undefined;
}

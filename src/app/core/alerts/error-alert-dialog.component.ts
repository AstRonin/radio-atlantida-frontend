import { ChangeDetectionStrategy, Component, Signal, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../i18n/translate.pipe';
import { logLink } from '../logs/log-query';
import { StationTimePipe } from '../time/station-time.pipe';
import type { Alert } from './alerts.service';

export interface ErrorAlertDialogData {
  alerts: Signal<readonly Alert[]>;
}

/**
 * The error popup. It reads the live list from its data, so alerts that arrive while it is
 * open are added to it. The texts are the backend's log messages, shown as sent.
 */
@Component({
  selector: 'app-error-alert-dialog',
  imports: [MatButtonModule, MatDialogModule, RouterLink, TranslatePipe, StationTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      {{ 'alerts.dialog.title' | translate: { count: alerts().length } }}
    </h2>
    <mat-dialog-content>
      <ul class="alerts">
        @for (alert of alerts(); track alert.id) {
          <li class="alert">
            <p class="meta">
              <time [attr.datetime]="alert.time">{{
                alert.time | stationTime: 'datetime-seconds'
              }}</time>
              @if (alert.component) {
                <span
                  >·
                  {{ 'alerts.dialog.component' | translate: { component: alert.component } }}</span
                >
              }
            </p>
            <p class="message">{{ alert.message }}</p>
            @if (alert.error) {
              <p class="error">{{ alert.error }}</p>
            }
            @if (alert.requestId) {
              <p class="meta">
                {{ 'alerts.dialog.requestId' | translate: { id: alert.requestId } }}
              </p>
            }
            <a class="log-link" routerLink="/logs" [queryParams]="logLink(alert)" mat-dialog-close>
              {{ 'alerts.dialog.openLog' | translate }}
            </a>
          </li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton="filled" type="button" mat-dialog-close>
        {{ 'common.close' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .alerts {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .alert + .alert {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .alert p {
      margin: 0.25rem 0;
    }

    .meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .message {
      font: var(--mat-sys-title-small);
    }

    .error {
      color: var(--mat-sys-error);
      overflow-wrap: anywhere;
    }

    .log-link {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ErrorAlertDialogComponent {
  protected readonly alerts = inject<ErrorAlertDialogData>(MAT_DIALOG_DATA).alerts;
  protected readonly logLink = logLink;
}

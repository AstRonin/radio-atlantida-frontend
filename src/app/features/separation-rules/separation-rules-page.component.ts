import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SettingsService } from '../../core/settings/settings.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  SeparationRule,
  SeparationRuleDialogComponent,
  SeparationRuleDialogData,
} from './separation-rule-dialog.component';

export const PLAY_LOG_DAYS_KEY = 'retention.play_log_days';
// The backend's default for retention.play_log_days, until the settings are read.
const DEFAULT_PLAY_LOG_DAYS = 10;

/**
 * Separation rules: how long a track or an artist must wait before it plays again. The values are
 * rows of the backend's table, never constants in code (design §4), so they are only edited here.
 */
@Component({
  selector: 'app-separation-rules-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    MatTableModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="separationRules.title" helpPage="help.separation-rules" />

    @if (rules.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="rules.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="scope">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'separationRules.fields.scope' | translate }}
          </th>
          <td mat-cell *matCellDef="let rule">
            {{ 'separationRules.scopes.' + rule.scope | translate }}
          </td>
        </ng-container>
        <ng-container matColumnDef="interval">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'separationRules.fields.min_interval_hours' | translate }}
          </th>
          <td mat-cell *matCellDef="let rule">
            {{ 'separationRules.hours' | translate: { hours: rule.min_interval_hours } }}
          </td>
        </ng-container>
        <ng-container matColumnDef="notes">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'separationRules.fields.notes' | translate }}
          </th>
          <td mat-cell *matCellDef="let rule">{{ rule.notes }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let rule" class="cell-actions">
            <button matButton type="button" (click)="edit(rule)">
              {{ 'common.edit' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!rules.isLoading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>
  `,
})
export default class SeparationRulesPageComponent {
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = ['scope', 'interval', 'notes', 'actions'];

  protected readonly rules = rxResource({
    stream: () => this.api.get('/api/separation-rules').pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() => (this.rules.hasValue() ? this.rules.value() : []));
  protected readonly loadError = computed(() =>
    this.rules.status() === 'error' ? errorMessage(this.rules.error(), this.i18n) : null,
  );

  private readonly maxHours = computed(() => {
    const days = this.settings.get(PLAY_LOG_DAYS_KEY)?.value;
    return (typeof days === 'number' ? days : DEFAULT_PLAY_LOG_DAYS) * 24;
  });

  protected edit(rule: SeparationRule): void {
    this.dialog
      .open<SeparationRuleDialogComponent, SeparationRuleDialogData, SeparationRule>(
        SeparationRuleDialogComponent,
        {
          data: { rule, maxHours: this.maxHours() },
          width: '32rem',
          maxWidth: 'calc(100vw - 2rem)',
        },
      )
      .afterClosed()
      .subscribe((saved) => saved && this.rules.reload());
  }
}

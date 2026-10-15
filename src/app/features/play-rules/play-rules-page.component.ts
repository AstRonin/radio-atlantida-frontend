import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import type { PlayRule } from './play-rule-form';

// 2024-01-01 was a Monday, so day N of the week is January N.
const MONDAY_UTC = Date.UTC(2024, 0, 1);

/**
 * Play rules with the number of tracks and playlists that use each (design §7.3). A rule in use
 * cannot be deleted; the refusal lists the tracks and playlists.
 */
@Component({
  selector: 'app-play-rules-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    MatTableModule,
    RouterLink,
    TranslatePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="playRules.title" helpPage="help.play-rules">
      <a matButton="filled" routerLink="/play-rules/new">{{ 'playRules.add' | translate }}</a>
    </app-page-header>

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
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ 'playRules.fields.name' | translate }}</th>
          <td mat-cell *matCellDef="let rule">
            <a [routerLink]="['/play-rules', rule.id]">{{ rule.name }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="window">
          <th mat-header-cell *matHeaderCellDef>{{ 'playRules.list.window' | translate }}</th>
          <td mat-cell *matCellDef="let rule">
            @if (rule.window_from && rule.window_to) {
              {{
                'playRules.list.windowRange'
                  | translate: { from: rule.window_from, to: rule.window_to }
              }}
            } @else {
              <span class="muted">{{ 'playRules.list.anyTime' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="weekdays">
          <th mat-header-cell *matHeaderCellDef>{{ 'playRules.fields.weekdays' | translate }}</th>
          <td mat-cell *matCellDef="let rule">
            @if (rule.weekdays?.length) {
              {{ dayNames(rule.weekdays) }}
            } @else {
              <span class="muted">{{ 'playRules.list.everyDay' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="interval">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'playRules.fields.min_interval_minutes' | translate }}
          </th>
          <td mat-cell *matCellDef="let rule">
            @if (rule.min_interval_minutes) {
              {{ 'playRules.list.minutes' | translate: { minutes: rule.min_interval_minutes } }}
            } @else {
              <span class="muted">–</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="perHour">
          <th mat-header-cell *matHeaderCellDef>
            {{ 'playRules.fields.max_per_hour' | translate }}
          </th>
          <td mat-cell *matCellDef="let rule">
            @if (rule.max_per_hour) {
              {{ rule.max_per_hour }}
            } @else {
              <span class="muted">–</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="uses">
          <th mat-header-cell *matHeaderCellDef>{{ 'playRules.list.uses' | translate }}</th>
          <td mat-cell *matCellDef="let rule">
            {{
              'playRules.list.usesValue'
                | translate: { tracks: rule.track_count, playlists: rule.playlist_count }
            }}
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let rule" class="cell-actions">
            <a matButton [routerLink]="['/play-rules', rule.id]">{{ 'common.edit' | translate }}</a>
            <button matButton type="button" (click)="remove(rule)">
              {{ 'common.delete' | translate }}
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
export default class PlayRulesPageComponent {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = [
    'name',
    'window',
    'weekdays',
    'interval',
    'perHour',
    'uses',
    'actions',
  ];

  protected readonly rules = rxResource({
    stream: () => this.api.get('/api/play-rules').pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() => (this.rules.hasValue() ? this.rules.value() : []));
  protected readonly loadError = computed(() =>
    this.rules.status() === 'error' ? errorMessage(this.rules.error(), this.i18n) : null,
  );

  private readonly dayFormat = computed(
    () => new Intl.DateTimeFormat(this.i18n.locale(), { weekday: 'short', timeZone: 'UTC' }),
  );

  protected dayNames(days: readonly number[]): string {
    const format = this.dayFormat();
    return days.map((day) => format.format(MONDAY_UTC + (day - 1) * 86_400_000)).join(', ');
  }

  protected remove(rule: PlayRule): void {
    this.confirm
      .confirmDelete({
        name: rule.name,
        action: () => this.api.delete('/api/play-rules/{id}', { path: { id: rule.id } }),
      })
      .subscribe((deleted) => deleted && this.rules.reload());
  }
}

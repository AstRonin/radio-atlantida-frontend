import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

type ClockSummary = ApiSchema<'ClockSummary'>;

/**
 * Clocks with the number of their playlists and timed inserts (design §7.2). A clock used in the
 * grid or with play history cannot be deleted; the refusal names the slots.
 */
@Component({
  selector: 'app-clocks-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    MatTableModule,
    RouterLink,
    TranslatePipe,
    StationTimePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="clocks.title" helpPage="help.clocks">
      <a matButton="filled" routerLink="/clocks/new">{{ 'clocks.add' | translate }}</a>
    </app-page-header>

    @if (clocks.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="clocks.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ 'clocks.fields.name' | translate }}</th>
          <td mat-cell *matCellDef="let clock">
            <a [routerLink]="['/clocks', clock.id]">{{ clock.name }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="playlists">
          <th mat-header-cell *matHeaderCellDef>{{ 'clocks.playlistCount' | translate }}</th>
          <td mat-cell *matCellDef="let clock">{{ clock.playlist_count }}</td>
        </ng-container>
        <ng-container matColumnDef="inserts">
          <th mat-header-cell *matHeaderCellDef>{{ 'clocks.insertCount' | translate }}</th>
          <td mat-cell *matCellDef="let clock">{{ clock.insert_count }}</td>
        </ng-container>
        <ng-container matColumnDef="updated">
          <th mat-header-cell *matHeaderCellDef>{{ 'clocks.updatedAt' | translate }}</th>
          <td mat-cell *matCellDef="let clock">{{ clock.updated_at | stationTime }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let clock" class="cell-actions">
            <a matButton [routerLink]="['/clocks', clock.id]">{{ 'common.edit' | translate }}</a>
            <button matButton type="button" (click)="remove(clock)">
              {{ 'common.delete' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!clocks.isLoading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>
  `,
})
export default class ClocksPageComponent {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = ['name', 'playlists', 'inserts', 'updated', 'actions'];

  protected readonly clocks = rxResource({
    stream: () => this.api.get('/api/clocks').pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() => (this.clocks.hasValue() ? this.clocks.value() : []));
  protected readonly loadError = computed(() =>
    this.clocks.status() === 'error' ? errorMessage(this.clocks.error(), this.i18n) : null,
  );

  protected remove(clock: ClockSummary): void {
    this.confirm
      .confirmDelete({
        name: clock.name,
        action: () => this.api.delete('/api/clocks/{id}', { path: { id: clock.id } }),
      })
      .subscribe((deleted) => deleted && this.clocks.reload());
  }
}

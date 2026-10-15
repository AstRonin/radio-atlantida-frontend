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
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  PlaylistType,
  PlaylistTypeDialogComponent,
  PlaylistTypeDialogData,
} from './playlist-type-dialog.component';

/**
 * Playlist types with their usage (design §4, §6.4). System types can be renamed but not deleted;
 * a type in use is refused by the backend with the playlists and tracks that use it.
 */
@Component({
  selector: 'app-playlist-types-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    MatTableModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="playlistTypes.title" helpPage="help.playlist-types">
      <button matButton="filled" type="button" (click)="create()">
        {{ 'playlistTypes.add' | translate }}
      </button>
    </app-page-header>

    @if (types.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="types.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlistTypes.fields.name' | translate }}</th>
          <td mat-cell *matCellDef="let type">{{ type.name }}</td>
        </ng-container>
        <ng-container matColumnDef="code">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlistTypes.fields.code' | translate }}</th>
          <td mat-cell *matCellDef="let type">
            <code>{{ type.code }}</code>
          </td>
        </ng-container>
        <ng-container matColumnDef="kind">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlistTypes.kind' | translate }}</th>
          <td mat-cell *matCellDef="let type">
            <span class="badge">
              {{ (type.is_system ? 'playlistTypes.system' : 'playlistTypes.custom') | translate }}
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="playlists">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlistTypes.playlists' | translate }}</th>
          <td mat-cell *matCellDef="let type">{{ type.playlist_count }}</td>
        </ng-container>
        <ng-container matColumnDef="tracks">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlistTypes.tracks' | translate }}</th>
          <td mat-cell *matCellDef="let type">{{ type.track_count }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let type" class="cell-actions">
            <button matButton type="button" (click)="rename(type)">
              {{ 'playlistTypes.rename' | translate }}
            </button>
            @if (!type.is_system) {
              <button matButton type="button" (click)="remove(type)">
                {{ 'common.delete' | translate }}
              </button>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!types.isLoading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>
  `,
})
export default class PlaylistTypesPageComponent {
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = ['name', 'code', 'kind', 'playlists', 'tracks', 'actions'];

  protected readonly types = rxResource({
    stream: () => this.api.get('/api/playlist-types').pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() => (this.types.hasValue() ? this.types.value() : []));
  protected readonly loadError = computed(() =>
    this.types.status() === 'error' ? errorMessage(this.types.error(), this.i18n) : null,
  );

  protected create(): void {
    this.openDialog({});
  }

  protected rename(type: PlaylistType): void {
    this.openDialog({ type });
  }

  protected remove(type: PlaylistType): void {
    this.confirm
      .confirmDelete({
        name: type.name,
        action: () => this.api.delete('/api/playlist-types/{id}', { path: { id: type.id } }),
      })
      .subscribe((deleted) => deleted && this.types.reload());
  }

  private openDialog(data: PlaylistTypeDialogData): void {
    this.dialog
      .open<PlaylistTypeDialogComponent, PlaylistTypeDialogData, PlaylistType>(
        PlaylistTypeDialogComponent,
        { data, width: '28rem', maxWidth: 'calc(100vw - 2rem)' },
      )
      .afterClosed()
      .subscribe((saved) => saved && this.types.reload());
  }
}

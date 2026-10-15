import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

type Playlist = ApiSchema<'Playlist'>;

/**
 * Playlists with their type and track count, filtered by type (`GET /api/playlists?type_id=`).
 * A playlist used by a clock cannot be deleted; the refusal names the clocks.
 */
@Component({
  selector: 'app-playlists-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="playlists.title" helpPage="help.playlists">
      <a matButton="filled" routerLink="/playlists/new">{{ 'playlists.add' | translate }}</a>
    </app-page-header>

    <div class="list-filters">
      <mat-form-field>
        <mat-label>{{ 'playlists.fields.type_id' | translate }}</mat-label>
        <mat-select [formControl]="typeFilter">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (type of types().items; track type.id) {
            <mat-option [value]="type.id">{{ type.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (playlists.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="playlists.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlists.fields.name' | translate }}</th>
          <td mat-cell *matCellDef="let playlist">
            <a [routerLink]="['/playlists', playlist.id]">{{ playlist.name }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlists.fields.type_id' | translate }}</th>
          <td mat-cell *matCellDef="let playlist">
            <span class="badge">{{ playlist.type.name }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="tracks">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlists.trackCount' | translate }}</th>
          <td mat-cell *matCellDef="let playlist">{{ playlist.track_count }}</td>
        </ng-container>
        <ng-container matColumnDef="rules">
          <th mat-header-cell *matHeaderCellDef>{{ 'playlists.ruleCount' | translate }}</th>
          <td mat-cell *matCellDef="let playlist">{{ playlist.play_rule_ids.length }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let playlist" class="cell-actions">
            <a matButton [routerLink]="['/playlists', playlist.id]">
              {{ 'common.edit' | translate }}
            </a>
            <button matButton type="button" (click)="remove(playlist)">
              {{ 'common.delete' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!playlists.isLoading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>
  `,
})
export default class PlaylistsPageComponent {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = ['name', 'type', 'tracks', 'rules', 'actions'];
  protected readonly types = catalogList(inject(CatalogService).playlistTypes());
  protected readonly typeFilter = new FormControl<number | null>(null);
  private readonly typeId = toSignal(this.typeFilter.valueChanges, { initialValue: null });

  protected readonly playlists = rxResource({
    params: () => ({ type_id: this.typeId() ?? undefined }),
    stream: ({ params }) =>
      this.api.get('/api/playlists', { query: params }).pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() =>
    this.playlists.hasValue() ? this.playlists.value() : [],
  );
  protected readonly loadError = computed(() =>
    this.playlists.status() === 'error' ? errorMessage(this.playlists.error(), this.i18n) : null,
  );

  protected remove(playlist: Playlist): void {
    this.confirm
      .confirmDelete({
        name: playlist.name,
        action: () => this.api.delete('/api/playlists/{id}', { path: { id: playlist.id } }),
      })
      .subscribe((deleted) => deleted && this.playlists.reload());
  }
}

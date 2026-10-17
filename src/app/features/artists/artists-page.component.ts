import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { Artist, ArtistDialogComponent, ArtistDialogData } from './artist-dialog.component';

export const ARTIST_SEARCH_DEBOUNCE_MS = 300;

/**
 * Artists, for the artist interval of play rules (design §4, §7.3). An artist with tracks or play history cannot be
 * deleted; the backend says why.
 */
@Component({
  selector: 'app-artists-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTableModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="artists.title" helpPage="help.library">
      <button matButton="filled" type="button" (click)="create()">
        {{ 'artists.add' | translate }}
      </button>
    </app-page-header>

    <div class="list-filters">
      <mat-form-field>
        <mat-label>{{ 'artists.search' | translate }}</mat-label>
        <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
      </mat-form-field>
    </div>

    @if (artists.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="artists.reload()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ 'artists.fields.name' | translate }}</th>
          <td mat-cell *matCellDef="let artist">{{ artist.name }}</td>
        </ng-container>
        <ng-container matColumnDef="tracks">
          <th mat-header-cell *matHeaderCellDef>{{ 'artists.tracks' | translate }}</th>
          <td mat-cell *matCellDef="let artist">{{ artist.track_count }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let artist" class="cell-actions">
            <button matButton type="button" (click)="rename(artist)">
              {{ 'artists.rename' | translate }}
            </button>
            <button matButton type="button" (click)="remove(artist)">
              {{ 'common.delete' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!artists.isLoading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>
  `,
})
export default class ArtistsPageComponent {
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  protected readonly columns = ['name', 'tracks', 'actions'];
  protected readonly search = signal('');
  private readonly query = toSignal(
    toObservable(this.search).pipe(
      map((text) => text.trim()),
      debounceTime(ARTIST_SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  protected readonly artists = rxResource({
    params: () => ({ q: this.query() || undefined }),
    stream: ({ params }) =>
      this.api.get('/api/artists', { query: params }).pipe(map((list) => list.items)),
  });
  protected readonly rows = computed(() => (this.artists.hasValue() ? this.artists.value() : []));
  protected readonly loadError = computed(() =>
    this.artists.status() === 'error' ? errorMessage(this.artists.error(), this.i18n) : null,
  );

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected create(): void {
    this.openDialog({});
  }

  protected rename(artist: Artist): void {
    this.openDialog({ artist });
  }

  protected remove(artist: Artist): void {
    this.confirm
      .confirmDelete({
        name: artist.name,
        action: () => this.api.delete('/api/artists/{id}', { path: { id: artist.id } }),
      })
      .subscribe((deleted) => deleted && this.artists.reload());
  }

  private openDialog(data: ArtistDialogData): void {
    this.dialog
      .open<ArtistDialogComponent, ArtistDialogData, Artist>(ArtistDialogComponent, {
        data,
        width: '28rem',
        maxWidth: 'calc(100vw - 2rem)',
      })
      .afterClosed()
      .subscribe((saved) => saved && this.artists.reload());
  }
}

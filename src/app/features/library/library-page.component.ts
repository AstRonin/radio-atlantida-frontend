import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { errorMessage } from '../../core/api/problem-message';
import { ApiClient } from '../../core/api/api-client.service';
import { CatalogService, TrackQuery, catalogList } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import type { Track } from './track-form';
import { TrackQualityComponent } from './track-quality.component';

export const LIBRARY_PAGE_SIZE = 100;
export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;

type Quality = NonNullable<TrackQuery['quality']>;
const QUALITIES: readonly Quality[] = ['ok', 'issues', 'unanalysed'];

interface PageRequest {
  query: TrackQuery;
  cursor?: string;
}

/**
 * The track library (docs/frontend-init-plan.md F5): search by title or artist, filters by
 * playlist, type, and quality, a play button on every row. Pages are read with the backend's
 * cursor, a hundred tracks at a time.
 */
@Component({
  selector: 'app-library-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    PageHeaderComponent,
    PlayButtonComponent,
    TrackQualityComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="library.title" helpPage="help.library">
      <a matButton="filled" routerLink="/library/new">{{ 'library.add' | translate }}</a>
    </app-page-header>

    <form class="list-filters" [formGroup]="filters" role="search">
      <mat-form-field>
        <mat-label>{{ 'library.filters.search' | translate }}</mat-label>
        <input matInput type="search" formControlName="q" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.playlist' | translate }}</mat-label>
        <mat-select formControlName="playlist_id">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (playlist of playlists().items; track playlist.id) {
            <mat-option [value]="playlist.id">{{ playlist.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.type' | translate }}</mat-label>
        <mat-select formControlName="type_id">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (type of types().items; track type.id) {
            <mat-option [value]="type.id">{{ type.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ 'library.filters.quality' | translate }}</mat-label>
        <mat-select formControlName="quality">
          <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
          @for (quality of qualities; track quality) {
            <mat-option [value]="quality">{{
              'library.quality.' + quality | translate
            }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </form>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="reload()">{{ 'common.retry' | translate }}</button>
      </p>
    }

    <div class="table-scroll">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="play">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'library.preview' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let track"><app-play-button [track]="track" /></td>
        </ng-container>
        <ng-container matColumnDef="title">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.title' | translate }}</th>
          <td mat-cell *matCellDef="let track">
            <a [routerLink]="['/library', track.id]">{{ track.title }}</a>
          </td>
        </ng-container>
        <ng-container matColumnDef="artist">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.artist_id' | translate }}</th>
          <td mat-cell *matCellDef="let track">{{ track.artist?.name }}</td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.type_id' | translate }}</th>
          <td mat-cell *matCellDef="let track">
            <span class="badge">{{ track.type.name }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="duration">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.duration_ms' | translate }}</th>
          <td mat-cell *matCellDef="let track" class="numeric">
            @if (track.duration_ms) {
              {{ track.duration_ms | duration }}
            } @else {
              <span class="badge warn">{{ 'library.noDuration' | translate }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="format">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.format' | translate }}</th>
          <td mat-cell *matCellDef="let track">{{ track.format }}</td>
        </ng-container>
        <ng-container matColumnDef="quality">
          <th mat-header-cell *matHeaderCellDef>{{ 'library.fields.quality_ok' | translate }}</th>
          <td mat-cell *matCellDef="let track"><app-track-quality [track]="track" /></td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let track" class="cell-actions">
            <a matButton [routerLink]="['/library', track.id]">{{ 'common.edit' | translate }}</a>
            <button matButton type="button" (click)="remove(track)">
              {{ 'common.delete' | translate }}
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-mdc-row" *matNoDataRow>
          @if (!loading() && !loadError()) {
            <td class="mat-mdc-cell muted" [attr.colspan]="columns.length">
              {{ 'common.empty' | translate }}
            </td>
          }
        </tr>
      </table>
    </div>

    @if (nextCursor()) {
      <div class="form-actions">
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'common.loadMore' | translate }}
        </button>
      </div>
    }
  `,
  styles: `
    .numeric {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export default class LibraryPageComponent {
  private readonly api = inject(ApiClient);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);

  protected readonly columns = [
    'play',
    'title',
    'artist',
    'type',
    'duration',
    'format',
    'quality',
    'actions',
  ];
  protected readonly qualities = QUALITIES;
  protected readonly playlists = catalogList(this.catalog.playlists());
  protected readonly types = catalogList(this.catalog.playlistTypes());

  protected readonly filters = new FormGroup({
    q: new FormControl(''),
    playlist_id: new FormControl<number | null>(null),
    type_id: new FormControl<number | null>(null),
    quality: new FormControl<Quality | null>(null),
  });

  protected readonly rows = signal<readonly Track[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly pages = new Subject<PageRequest>();
  private query: TrackQuery = { limit: LIBRARY_PAGE_SIZE };

  constructor() {
    this.pages
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.loadError.set(null);
          return this.api
            .get('/api/tracks', { query: { ...request.query, cursor: request.cursor } })
            .pipe(
              map((page) => ({ request, page, error: null as unknown })),
              catchError((error: unknown) => of({ request, page: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ request, page, error }) => {
        this.loading.set(false);
        if (!page) {
          this.loadError.set(errorMessage(error, this.i18n));
          return;
        }
        this.rows.update((rows) => (request.cursor ? [...rows, ...page.items] : page.items));
        this.nextCursor.set(page.next_cursor ?? null);
      });

    // One debounce for every filter, so typing in the search reads one page after a pause.
    this.filters.valueChanges
      .pipe(
        debounceTime(LIBRARY_SEARCH_DEBOUNCE_MS),
        startWith(this.filters.value),
        map((value): TrackQuery => ({
          q: value.q?.trim() || undefined,
          playlist_id: value.playlist_id ?? undefined,
          type_id: value.type_id ?? undefined,
          quality: value.quality ?? undefined,
          limit: LIBRARY_PAGE_SIZE,
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(),
      )
      .subscribe((query) => {
        this.query = query;
        this.pages.next({ query });
      });
  }

  protected reload(): void {
    this.pages.next({ query: this.query });
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.pages.next({ query: this.query, cursor });
    }
  }

  protected remove(track: Track): void {
    this.confirm
      .confirmDelete({
        name: track.title,
        action: () => this.api.delete('/api/tracks/{id}', { path: { id: track.id } }),
      })
      .subscribe((deleted) => deleted && this.reload());
  }
}

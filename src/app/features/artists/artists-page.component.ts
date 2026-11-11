import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import type { ArtistQuery } from '../../core/catalog/catalog.service';
import { I18nService, TranslationParams } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { providePaginatorIntl } from '../../shared/ui/paginator-intl';
import { Artist, ArtistDialogComponent, ArtistDialogData } from './artist-dialog.component';
import {
  ARTISTS_PAGE_SIZES,
  ArtistsListState,
  DEFAULT_ARTISTS_LIST_STATE,
  artistsListStateParams,
  isArtistSort,
  readArtistsListState,
} from './artists-list-state';

export const ARTIST_SEARCH_DEBOUNCE_MS = 300;

interface PageRequest {
  query: ArtistQuery;
  /** Set on the read of the last page after a page came back empty, so it happens once. */
  corrected?: boolean;
}

/**
 * Artists, for the artist interval of play rules (design §4, §7.3). The backend searches, sorts,
 * and pages the list; the page, its size, and the order are kept in the URL. An artist with
 * tracks cannot be deleted, so its Delete is disabled with the reason, and its track count opens
 * its tracks in the library. An artist with play history is refused by the backend, which says why.
 */
@Component({
  selector: 'app-artists-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
    PageHeaderComponent,
  ],
  providers: [providePaginatorIntl()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="artists.title" helpPage="help.library">
      <button matButton="filled" type="button" (click)="create()">
        {{ 'artists.add' | translate }}
      </button>
    </app-page-header>

    <div class="list-filters" role="search">
      <mat-form-field>
        <mat-label>{{ 'artists.search' | translate }}</mat-label>
        <input matInput type="search" [value]="search()" (input)="onSearch($event)" />
      </mat-form-field>
    </div>

    <div class="load-slot">
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
    </div>
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="readPage()">
          {{ 'common.retry' | translate }}
        </button>
      </p>
    }

    <div class="table-scroll">
      <!-- A plain array as the data source: MatSort only reports the click, the backend sorts. -->
      <table
        mat-table
        [dataSource]="rows()"
        matSort
        [matSortActive]="list().sort"
        [matSortDirection]="list().order"
        matSortDisableClear
        matSortStart="asc"
        (matSortChange)="onSort($event)"
      >
        <ng-container matColumnDef="name">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'artists.sortBy' | translate: { column: ('artists.fields.name' | translate) }
            "
          >
            {{ 'artists.fields.name' | translate }}
          </th>
          <td mat-cell *matCellDef="let artist">{{ artist.name }}</td>
        </ng-container>
        <ng-container matColumnDef="track_count">
          <th
            mat-header-cell
            *matHeaderCellDef
            mat-sort-header
            [sortActionDescription]="
              'artists.sortBy' | translate: { column: ('artists.tracks' | translate) }
            "
          >
            {{ 'artists.tracks' | translate }}
          </th>
          <td mat-cell *matCellDef="let artist" class="numeric">
            @if (artist.track_count > 0) {
              <a
                class="tracks-link"
                routerLink="/library"
                [queryParams]="{ artist_id: artist.id }"
                [attr.aria-label]="
                  'artists.showTracks' | translate: { count: artist.track_count, name: artist.name }
                "
                >{{ artist.track_count }}</a
              >
            } @else {
              {{ artist.track_count }}
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>
            <span class="cdk-visually-hidden">{{ 'common.actions' | translate }}</span>
          </th>
          <td mat-cell *matCellDef="let artist" class="cell-actions">
            <button matButton type="button" (click)="rename(artist)">
              {{ 'artists.rename' | translate }}
            </button>
            <!-- disabledInteractive keeps the button focusable and hoverable while aria-disabled,
                 so the tooltip (also its accessible description) reaches mouse and keyboard. -->
            @let blocked = artist.track_count > 0;
            <button
              matButton
              type="button"
              class="delete"
              [disabled]="blocked"
              disabledInteractive
              [matTooltip]="
                blocked ? ('artists.deleteBlocked' | translate: { count: artist.track_count }) : ''
              "
              [matTooltipDisabled]="!blocked"
              (click)="remove(artist)"
            >
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

    <mat-paginator
      [length]="total()"
      [pageIndex]="list().pageIndex"
      [pageSize]="list().pageSize"
      [pageSizeOptions]="pageSizes"
      showFirstLastButtons
      (page)="onPage($event)"
    />
    <p class="page-status cdk-visually-hidden" role="status">
      @if (pageStatus(); as status) {
        {{ 'artists.pageStatus' | translate: status }}
      }
    </p>
  `,
  styles: `
    /* The space is kept when the bar is gone, or the table would move on every reload. */
    .load-slot {
      height: 4px;
    }

    .numeric {
      font-variant-numeric: tabular-nums;
    }

    .tracks-link {
      color: var(--mat-sys-primary);
    }

    .tracks-link:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
  `,
})
export default class ArtistsPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Query parameters of the list state (artists-list-state.ts), read once when the page opens. */
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();
  readonly order = input<string>();

  protected readonly columns = ['name', 'track_count', 'actions'];
  protected readonly pageSizes = ARTISTS_PAGE_SIZES;
  protected readonly search = signal('');
  protected readonly list = signal<ArtistsListState>(DEFAULT_ARTISTS_LIST_STATE);
  protected readonly rows = signal<readonly Artist[]>([]);
  protected readonly total = signal(0);
  /** Set when a page arrives, not when it is asked for, so the announcement matches the rows. */
  protected readonly pageStatus = signal<TranslationParams | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly searches = new Subject<string>();
  private readonly pages = new Subject<PageRequest>();
  private searchQuery: string | undefined;

  constructor() {
    // One request at a time: a slow old page never overwrites a newer one.
    this.pages
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.loadError.set(null);
          return this.api.get('/api/artists', { query: request.query }).pipe(
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
        const { pageSize } = this.list();
        const offset = request.query.offset ?? 0;
        if (page.items.length === 0 && offset > 0 && page.total > 0 && !request.corrected) {
          // The last page was emptied, by a delete here or elsewhere: show the new last page.
          this.setList({ ...this.list(), pageIndex: Math.ceil(page.total / pageSize) - 1 });
          this.pages.next({ query: this.pageQuery(), corrected: true });
          return;
        }
        this.rows.set(page.items);
        this.total.set(page.total);
        this.pageStatus.set({
          page: this.list().pageIndex + 1,
          pages: Math.max(1, Math.ceil(page.total / pageSize)),
          total: page.total,
        });
      });
  }

  ngOnInit(): void {
    // Router inputs are set before the first change detection, not in the constructor.
    this.list.set(
      readArtistsListState({
        page: this.page(),
        size: this.size(),
        sort: this.sort(),
        order: this.order(),
      }),
    );
    let first = true;
    this.searches
      .pipe(
        map((text) => text.trim()),
        debounceTime(ARTIST_SEARCH_DEBOUNCE_MS),
        startWith(''),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((text) => {
        this.searchQuery = text || undefined;
        // The page from the URL holds for the first read; a new search starts at page 1.
        if (!first) {
          this.setList({ ...this.list(), pageIndex: 0 });
        }
        first = false;
        this.readPage();
      });
  }

  protected onSearch(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.search.set(text);
    this.searches.next(text);
  }

  protected onSort(sort: Sort): void {
    if (!isArtistSort(sort.active)) {
      return;
    }
    this.setList({
      ...this.list(),
      sort: sort.active,
      order: sort.direction || 'asc',
      pageIndex: 0,
    });
    this.readPage();
  }

  /** A new page size comes with the paginator's page that holds the first row of the old one. */
  protected onPage(event: PageEvent): void {
    this.setList({ ...this.list(), pageIndex: event.pageIndex, pageSize: event.pageSize });
    this.readPage();
  }

  protected readPage(): void {
    this.pages.next({ query: this.pageQuery() });
  }

  private pageQuery(): ArtistQuery {
    const { pageIndex, pageSize, sort, order } = this.list();
    return { q: this.searchQuery, sort, order, offset: pageIndex * pageSize, limit: pageSize };
  }

  /** Reloading the browser, or coming back from the library, then opens the same page. */
  private setList(state: ArtistsListState): void {
    this.list.set(state);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: artistsListStateParams(state),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected create(): void {
    this.openDialog({});
  }

  protected rename(artist: Artist): void {
    this.openDialog({ artist });
  }

  protected remove(artist: Artist): void {
    // The button stays focusable while disabled (for its tooltip), so a click still arrives here.
    if (artist.track_count > 0) {
      return;
    }
    this.confirm
      .confirmDelete({
        name: artist.name,
        action: () => this.api.delete('/api/artists/{id}', { path: { id: artist.id } }),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted) => deleted && this.readPage());
  }

  private openDialog(data: ArtistDialogData): void {
    this.dialog
      .open<ArtistDialogComponent, ArtistDialogData, Artist>(ArtistDialogComponent, {
        data,
        width: '28rem',
        maxWidth: 'calc(100vw - 2rem)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved) => saved && this.readPage());
  }
}

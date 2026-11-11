import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import ArtistsPageComponent, { ARTIST_SEARCH_DEBOUNCE_MS } from './artists-page.component';
import {
  ArtistsListParams,
  DEFAULT_ARTISTS_LIST_STATE,
  artistsListStateParams,
  readArtistsListState,
} from './artists-list-state';

type Artist = ApiSchema<'Artist'>;

const artist = (id: number, trackCount = 0, name = `Artist ${id}`): Artist => ({
  id,
  name,
  track_count: trackCount,
});

describe('artists list state', () => {
  it('reads the state from the URL and falls back per value', () => {
    expect(readArtistsListState({})).toEqual(DEFAULT_ARTISTS_LIST_STATE);
    expect(
      readArtistsListState({ page: '3', size: '25', sort: 'track_count', order: 'desc' }),
    ).toEqual({ pageIndex: 2, pageSize: 25, sort: 'track_count', order: 'desc' });
    expect(readArtistsListState({ page: '0', size: '30', sort: 'title', order: 'up' })).toEqual(
      DEFAULT_ARTISTS_LIST_STATE,
    );
  });

  it('writes only what differs from the default', () => {
    expect(artistsListStateParams(DEFAULT_ARTISTS_LIST_STATE)).toEqual({
      page: null,
      size: null,
      sort: null,
      order: null,
    });
    expect(
      artistsListStateParams({ pageIndex: 1, pageSize: 100, sort: 'track_count', order: 'desc' }),
    ).toEqual({ page: 2, size: 100, sort: 'track_count', order: 'desc' });
  });
});

describe('ArtistsPageComponent', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes(label),
    );
  const artistsRequest = (params: Record<string, string | null>) =>
    http.expectOne(
      (req) =>
        req.method === 'GET' &&
        req.url === '/api/artists' &&
        Object.entries(params).every(([name, value]) => req.params.get(name) === value),
    );
  const rowsOf = (page: HTMLElement) => [...page.querySelectorAll('tr.mat-mdc-row')];
  const deleteButton = (row: Element) => row.querySelector<HTMLButtonElement>('button.delete');
  const header = (page: HTMLElement, column: string) =>
    page.querySelector<HTMLElement>(`th.mat-column-${column}`);
  const paginator = (fixture: ComponentFixture<ArtistsPageComponent>) =>
    fixture.debugElement.query(By.directive(MatPaginator)).componentInstance as MatPaginator;
  const pageButton = (page: HTMLElement, which: 'next' | 'previous' | 'first' | 'last') =>
    page.querySelector<HTMLButtonElement>(`.mat-mdc-paginator-navigation-${which}`);

  async function createPage(params: ArtistsListParams = {}) {
    const fixture = TestBed.createComponent(ArtistsPageComponent);
    for (const [name, value] of Object.entries(params)) {
      fixture.componentRef.setInput(name, value);
    }
    await settlePage();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  }

  it('reads the first page by name and pages and sorts on the server', async () => {
    const { fixture, page } = await createPage();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    artistsRequest({
      q: null,
      sort: 'name',
      order: 'asc',
      offset: '0',
      limit: '50',
    }).flush({ items: [artist(1), artist(2)], total: 120 });
    await settlePage();
    expect(rowsOf(page)).toHaveLength(2);
    expect(paginator(fixture).length).toBe(120);
    expect(page.querySelector('.page-status')?.textContent).toContain('artists.pageStatus');

    pageButton(page, 'next')?.click();
    artistsRequest({ offset: '50', limit: '50', sort: 'name' }).flush({
      items: [artist(51)],
      total: 120,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { page: 2, size: null, sort: null, order: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
    await settlePage();

    header(page, 'track_count')?.querySelector<HTMLElement>('.mat-sort-header-container')?.click();
    artistsRequest({ sort: 'track_count', order: 'asc', offset: '0' }).flush({
      items: [artist(1)],
      total: 120,
    });
    await settlePage();
    header(page, 'track_count')?.querySelector<HTMLElement>('.mat-sort-header-container')?.click();
    artistsRequest({ sort: 'track_count', order: 'desc', offset: '0' }).flush({
      items: [artist(1)],
      total: 120,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { page: null, size: null, sort: 'track_count', order: 'desc' },
      }),
    );
    await settlePage();

    paginator(fixture).page.emit({
      pageIndex: 0,
      pageSize: 100,
      previousPageIndex: 0,
      length: 120,
    });
    artistsRequest({ limit: '100', offset: '0', sort: 'track_count' }).flush({
      items: [artist(1)],
      total: 120,
    });
    await settlePage();
  });

  it('opens the page and order from the URL without writing it', async () => {
    const { page } = await createPage({
      page: '3',
      size: '25',
      sort: 'track_count',
      order: 'desc',
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    artistsRequest({ offset: '50', limit: '25', sort: 'track_count', order: 'desc' }).flush({
      items: [artist(51)],
      total: 80,
    });
    await settlePage();
    expect(header(page, 'track_count')?.getAttribute('aria-sort')).toBe('descending');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('starts a new search at the first page', async () => {
    const { page } = await createPage({ page: '2' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    artistsRequest({ offset: '50' }).flush({ items: [artist(51)], total: 80 });
    await settlePage();

    const search = page.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    search.value = ' ann ';
    search.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, ARTIST_SEARCH_DEBOUNCE_MS));
    await settlePage();
    artistsRequest({ q: 'ann', offset: '0', limit: '50' }).flush({
      items: [artist(1, 0, 'Ann')],
      total: 1,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ page: null }) }),
    );
    await settlePage();
  });

  it('shows the new last page when a delete empties the last one', async () => {
    const { page } = await createPage({ page: '3' });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    artistsRequest({ offset: '100' }).flush({ items: [artist(101)], total: 101 });
    await settlePage();

    deleteButton(rowsOf(page)[0])?.click();
    await settlePage();
    button(overlay, 'common.delete')?.click();
    http.expectOne({ method: 'DELETE', url: '/api/artists/101' }).flush(null);
    await settlePage();
    artistsRequest({ offset: '100' }).flush({ items: [], total: 100 });
    artistsRequest({ offset: '50' }).flush({ items: [artist(51)], total: 100 });
    await settlePage();
    expect(page.querySelector('.page-status')?.textContent).toContain('artists.pageStatus');
    expect(rowsOf(page)).toHaveLength(1);
  });

  it('disables Delete for an artist with tracks and says why', async () => {
    const i18n = TestBed.inject(I18nService);
    const texts = vi.spyOn(i18n, 'translate');
    const { fixture, page } = await createPage();
    artistsRequest({}).flush({ items: [artist(1, 3), artist(2, 0)], total: 2 });
    await settlePage();

    const [withTracks, withoutTracks] = rowsOf(page);
    const blocked = deleteButton(withTracks) as HTMLButtonElement;
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    // Focusable, so a keyboard reaches the tooltip and its description.
    expect(blocked.hasAttribute('disabled')).toBe(false);
    expect(texts).toHaveBeenCalledWith('artists.deleteBlocked', { count: 3 });
    const tooltipOf = (element: HTMLButtonElement) =>
      fixture.debugElement
        .queryAll(By.directive(MatTooltip))
        .find((item) => item.nativeElement === element)
        ?.injector.get(MatTooltip);
    expect(tooltipOf(blocked)?.disabled).toBe(false);
    expect(tooltipOf(blocked)?.message).toBe('artists.deleteBlocked');

    blocked.click();
    await settlePage();
    expect(overlay.querySelector('mat-dialog-container')).toBeNull();

    const allowed = deleteButton(withoutTracks) as HTMLButtonElement;
    expect(allowed.getAttribute('aria-disabled')).toBeNull();
    expect(tooltipOf(allowed)?.disabled).toBe(true);
  });

  it('still shows the refusal of an artist with play history', async () => {
    const { page } = await createPage();
    artistsRequest({}).flush({ items: [artist(2, 0, 'Old Band')], total: 1 });
    await settlePage();

    deleteButton(rowsOf(page)[0])?.click();
    await settlePage();
    button(overlay, 'common.delete')?.click();
    http.expectOne({ method: 'DELETE', url: '/api/artists/2' }).flush(
      {
        status: 409,
        code: 'artist_has_history',
        title: 'Conflict',
        detail: 'The artist has aired and is kept for the played-tracks list.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settlePage();
    expect(overlay.textContent).toContain('The artist has aired');
  });

  it('links a track count to the library filtered by the artist; 0 is no link', async () => {
    const i18n = TestBed.inject(I18nService);
    const texts = vi.spyOn(i18n, 'translate');
    const { page } = await createPage();
    artistsRequest({}).flush({ items: [artist(5, 3, 'Ann'), artist(6, 0)], total: 2 });
    await settlePage();

    const [withTracks, withoutTracks] = rowsOf(page);
    const link = withTracks.querySelector<HTMLAnchorElement>('td.mat-column-track_count a');
    expect(link?.getAttribute('href')).toBe('/library?artist_id=5');
    expect(link?.textContent?.trim()).toBe('3');
    expect(link?.getAttribute('aria-label')).toBe('artists.showTracks');
    expect(texts).toHaveBeenCalledWith('artists.showTracks', { count: 3, name: 'Ann' });
    expect(withoutTracks.querySelector('td.mat-column-track_count a')).toBeNull();
    expect(withoutTracks.querySelector('td.mat-column-track_count')?.textContent?.trim()).toBe('0');
  });

  it('adds an artist and marks a name that is taken', async () => {
    const { page } = await createPage();
    artistsRequest({ q: null }).flush({
      items: [artist(1, 3, 'Arto Tunçboyacıyan')],
      total: 1,
    });
    await settlePage();

    button(page, 'artists.add')?.click();
    await settlePage();
    const name = overlay.querySelector<HTMLInputElement>('input');
    if (!name) {
      throw new Error('No name field.');
    }
    name.value = 'Arto Tunçboyacıyan';
    name.dispatchEvent(new Event('input'));
    await settlePage();
    button(overlay, 'common.save')?.click();

    http.expectOne({ method: 'POST', url: '/api/artists' }).flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Validation failed',
        errors: [{ field: 'name', code: 'taken', message: 'another artist has this name' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();
    expect(overlay.textContent).toContain('another artist has this name');
  });
});

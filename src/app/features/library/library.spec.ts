import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent, { LIBRARY_SEARCH_DEBOUNCE_MS } from './library-page.component';
import {
  LIBRARY_DEFAULT_PAGE_SIZE,
  LibraryListParams,
  listStateParams,
  readListState,
} from './library-list-state';
import TrackEditComponent from './track-edit.component';
import { Track, trackBody, trackForm, trackFormValue } from './track-form';

const track = (id: number, overrides: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artist: { id: 50, name: 'Artist' },
  duration_ms: 225_000,
  file_path: `music/${id}.mp3`,
  format: 'mp3',
  bitrate: 320_000,
  sample_rate: 44_100,
  quality_ok: true,
  fixes: [],
  play_rule_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  playlist_ids: [],
  quality_issues: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  ...overrides,
});

describe('library', () => {
  describe('track form validation (design §6.2)', () => {
    it('needs a title, a type, and a file path', () => {
      const form = trackForm();
      expect(form.controls.title.hasError('required')).toBe(true);
      expect(form.controls.type_id.hasError('required')).toBe(true);
      expect(form.controls.file_path.hasError('required')).toBe(true);

      form.patchValue({ title: 'Song', type_id: 1, file_path: 'music/song.mp3' });
      expect(form.valid).toBe(true);
    });

    it('refuses absolute paths and .. before sending', () => {
      const form = trackForm();
      for (const path of ['/media/music/song.mp3', '../song.mp3', 'C:/song.mp3', 'a\\b.mp3']) {
        form.controls.file_path.setValue(path);
        expect(form.controls.file_path.hasError('relativePath'), path).toBe(true);
      }
    });

    it('limits the length to six hours and the texts to their DTO lengths', () => {
      const form = trackForm();
      form.controls.duration_ms.setValue(0);
      expect(form.controls.duration_ms.hasError('range')).toBe(true);
      form.controls.duration_ms.setValue(21_600_001);
      expect(form.controls.duration_ms.hasError('range')).toBe(true);
      form.controls.duration_ms.setValue(null);
      expect(form.controls.duration_ms.valid).toBe(true);

      form.controls.title.setValue('x'.repeat(501));
      expect(form.controls.title.hasError('maxlength')).toBe(true);
      form.controls.quality_notes.setValue('x'.repeat(2001));
      expect(form.controls.quality_notes.hasError('maxlength')).toBe(true);
    });
  });

  describe('request body', () => {
    it('sends back the values this page does not edit, so the update keeps them', () => {
      const stored = track(3, { quality_ok: false, quality_issues: ['loudness'] });
      const form = trackForm();
      form.reset(trackFormValue(stored));
      form.controls.title.setValue(' New title ');

      expect(trackBody(form, stored)).toEqual({
        title: 'New title',
        artist_id: 50,
        type_id: 1,
        file_path: 'music/3.mp3',
        duration_ms: 225_000,
        quality_notes: '',
        playlist_ids: [],
        format: 'mp3',
        bitrate: 320_000,
        sample_rate: 44_100,
        quality_ok: false,
      });
    });

    it('leaves the file values out on create, so the backend reads them from the file', () => {
      const form = trackForm();
      form.patchValue({ title: 'Jingle', type_id: 2, file_path: 'jingles/id.mp3' });
      const body = trackBody(form, null);
      expect(body).not.toHaveProperty('format');
      expect(body).not.toHaveProperty('quality_ok');
      expect(body).toMatchObject({ artist_id: null, duration_ms: null, playlist_ids: [] });
    });
  });

  describe('list state in the URL', () => {
    it('reads valid parameters', () => {
      expect(readListState({ page: '3', size: '25', sort: 'artist', order: 'desc' })).toEqual({
        pageIndex: 2,
        pageSize: 25,
        sort: 'artist',
        order: 'desc',
      });
    });

    it('falls back to the default for each value not allowed', () => {
      const defaults = { pageIndex: 0, pageSize: 50, sort: 'title', order: 'asc' };
      const invalid: LibraryListParams[] = [
        {},
        { sort: 'bitrate' },
        { sort: 'constructor' },
        { order: 'up' },
        { size: '37' },
        { page: '0' },
        { page: 'abc' },
        { page: '-2' },
        { page: '1.5' },
      ];
      for (const params of invalid) {
        expect(readListState(params), JSON.stringify(params)).toEqual(defaults);
      }
      expect(readListState({ page: '2', size: '37' })).toEqual({ ...defaults, pageIndex: 1 });
    });

    it('leaves the defaults out of the URL', () => {
      expect(listStateParams(readListState({}))).toEqual({
        page: null,
        size: null,
        sort: null,
        order: null,
      });
      expect(
        listStateParams({ pageIndex: 6, pageSize: 100, sort: 'duration', order: 'desc' }),
      ).toEqual({ page: 7, size: 100, sort: 'duration', order: 'desc' });
    });
  });

  describe('pages', () => {
    let http: HttpTestingController;
    let overlay: HTMLElement;
    let server: FakeSocketServer;

    beforeEach(() => {
      server = new FakeSocketServer();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([apiProblemInterceptor])),
          provideHttpClientTesting(),
          provideRouter([]),
          server.provider,
          provideFakeAudio(new FakeAudio()),
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
    const tracksRequest = (params: Record<string, string>) =>
      http.expectOne(
        (req) =>
          req.url === '/api/tracks' &&
          Object.entries(params).every(([name, value]) => req.params.get(name) === value),
      );

    describe('LibraryPageComponent', () => {
      async function createPage(params: LibraryListParams = {}) {
        const fixture = TestBed.createComponent(LibraryPageComponent);
        for (const [name, value] of Object.entries(params)) {
          fixture.componentRef.setInput(name, value);
        }
        await settlePage();
        http.expectOne('/api/playlists').flush({ items: [] });
        http.expectOne('/api/playlist-types').flush({ items: [] });
        return fixture;
      }

      const titles = (page: HTMLElement) =>
        [...page.querySelectorAll('tr.mat-mdc-row td.mat-column-title')].map((cell) =>
          cell.textContent?.trim(),
        );
      const header = (page: HTMLElement, column: string) =>
        page.querySelector<HTMLElement>(`th.mat-column-${column}`);
      const paginator = (fixture: ComponentFixture<LibraryPageComponent>) =>
        fixture.debugElement.query(By.directive(MatPaginator)).componentInstance as MatPaginator;
      const pageButton = (page: HTMLElement, which: 'next' | 'previous' | 'first' | 'last') =>
        page.querySelector<HTMLButtonElement>(`.mat-mdc-paginator-navigation-${which}`);
      const checked = (page: HTMLElement) =>
        page.querySelectorAll('tr.mat-mdc-row mat-checkbox.mat-mdc-checkbox-checked').length;
      async function selectRow(page: HTMLElement, index: number): Promise<void> {
        page
          .querySelectorAll('tr.mat-mdc-row')
          [index].querySelector<HTMLInputElement>('mat-checkbox input')
          ?.click();
        await settlePage();
      }

      it('reads the first page by title with a play button on every row', async () => {
        const fixture = await createPage();
        const first = tracksRequest({
          sort: 'title',
          order: 'asc',
          offset: '0',
          limit: String(LIBRARY_DEFAULT_PAGE_SIZE),
        });
        expect(first.request.params.has('cursor')).toBe(false);
        first.flush({
          items: [track(1), track(2, { duration_ms: undefined, quality_ok: undefined })],
          total: 3412,
        });
        await settlePage();

        const page = fixture.nativeElement as HTMLElement;
        const rows = page.querySelectorAll('tr.mat-mdc-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('app-play-button')).not.toBeNull();
        expect(rows[1].querySelector('app-play-button')).not.toBeNull();
        expect(rows[1].textContent).toContain('library.noDuration');
        expect(rows[1].textContent).toContain('library.quality.unanalysed');
        expect(paginator(fixture).length).toBe(3412);
        expect(page.querySelector('.page-status')?.textContent).toContain('library.pageStatus');
        expect(button(page, 'common.loadMore')).toBeUndefined();
        expect(header(page, 'title')?.getAttribute('aria-sort')).toBe('ascending');
        for (const column of ['select', 'play', 'actions']) {
          expect(header(page, column)?.hasAttribute('mat-sort-header'), column).toBe(false);
        }
      });

      it('sorts on the backend and shows the rows in the order it returns', async () => {
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1)], total: 120 });
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;
        pageButton(page, 'next')?.click();
        tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 120 });
        await settlePage();

        header(page, 'duration')?.click();
        await settlePage();
        // Deliberately not in duration order: the page must not sort them again.
        tracksRequest({ sort: 'duration', order: 'asc', offset: '0', limit: '50' }).flush({
          items: [
            track(3, { duration_ms: 300_000 }),
            track(1, { duration_ms: 100_000 }),
            track(2, { duration_ms: 200_000 }),
          ],
          total: 120,
        });
        await settlePage();
        expect(titles(page)).toEqual(['Song 3', 'Song 1', 'Song 2']);
        expect(header(page, 'duration')?.getAttribute('aria-sort')).toBe('ascending');
        expect(header(page, 'title')?.getAttribute('aria-sort')).toBe('none');
        expect(paginator(fixture).pageIndex).toBe(0);

        header(page, 'duration')?.click();
        await settlePage();
        tracksRequest({ sort: 'duration', order: 'desc', offset: '0' }).flush({
          items: [track(2)],
          total: 120,
        });
        await settlePage();
        expect(header(page, 'duration')?.getAttribute('aria-sort')).toBe('descending');
      });

      it('reads the page that holds the first row after a size change, page 1 after a filter', async () => {
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1)], total: 300 });
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;

        header(page, 'artist')?.click();
        await settlePage();
        tracksRequest({ sort: 'artist', offset: '0' }).flush({ items: [track(1)], total: 300 });
        await settlePage();
        pageButton(page, 'next')?.click();
        tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 300 });
        await settlePage();
        pageButton(page, 'next')?.click();
        tracksRequest({ offset: '100' }).flush({ items: [track(101)], total: 300 });
        await settlePage();

        // Row 101 is on page 2 of 100.
        paginator(fixture)._changePageSize(100);
        await settlePage();
        tracksRequest({ sort: 'artist', offset: '100', limit: '100' }).flush({
          items: [track(101)],
          total: 300,
        });
        await settlePage();

        const component = fixture.componentInstance as unknown as {
          filters: { controls: { type_id: { setValue(value: number): void } } };
        };
        component.filters.controls.type_id.setValue(3);
        await new Promise((resolve) => setTimeout(resolve, LIBRARY_SEARCH_DEBOUNCE_MS));
        await settlePage();
        tracksRequest({
          type_id: '3',
          sort: 'artist',
          order: 'asc',
          offset: '0',
          limit: '100',
        }).flush({ items: [track(7)], total: 1 });
        await settlePage();
        expect(paginator(fixture).pageIndex).toBe(0);
      });

      it('opens the page and order from the URL and keeps them there', async () => {
        const fixture = await createPage({ page: '3', size: '25', sort: 'artist', order: 'desc' });
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        tracksRequest({ offset: '50', limit: '25', sort: 'artist', order: 'desc' }).flush({
          items: [track(51)],
          total: 200,
        });
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;
        expect(header(page, 'artist')?.getAttribute('aria-sort')).toBe('descending');
        expect(navigate).not.toHaveBeenCalled();

        pageButton(page, 'next')?.click();
        tracksRequest({ offset: '75', limit: '25' }).flush({ items: [track(76)], total: 200 });
        expect(navigate).toHaveBeenCalledWith(
          [],
          expect.objectContaining({
            queryParams: {
              page: 4,
              size: 25,
              sort: 'artist',
              order: 'desc',
              quality: null,
              reviewed: null,
              in_plan: null,
              in_playlist: null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          }),
        );

        pageButton(page, 'first')?.click();
        tracksRequest({ offset: '0', limit: '25' }).flush({ items: [track(1)], total: 200 });
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({
            queryParams: {
              page: null,
              size: 25,
              sort: 'artist',
              order: 'desc',
              quality: null,
              reviewed: null,
              in_plan: null,
              in_playlist: null,
            },
          }),
        );
      });

      it('reloads the same page on an event and moves to the last page when it emptied', async () => {
        TestBed.inject(RealtimeService).connect();
        server.latest.open();
        const fixture = await createPage({ page: '3', sort: 'duration' });
        tracksRequest({ offset: '100', sort: 'duration' }).flush({
          items: [track(101)],
          total: 101,
        });
        await settlePage();

        server.latest.send({
          type: 'analyse.completed',
          time: '2026-10-16T08:00:00Z',
          operation_id: 9,
          data: { kind: 'analyse', summary: '1 analysed' },
        });
        await settlePage();
        tracksRequest({ offset: '100', sort: 'duration', limit: '50' }).flush({
          items: [],
          total: 100,
        });
        await settlePage();
        // Read once more, at the new last page.
        tracksRequest({ offset: '50', sort: 'duration' }).flush({ items: [track(51)], total: 100 });
        await settlePage();
        expect(paginator(fixture).pageIndex).toBe(1);
        expect(titles(fixture.nativeElement as HTMLElement)).toEqual(['Song 51']);
      });

      it('keeps the selection across pages and sorts, and clears it on a filter change', async () => {
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1), track(2), track(3)], total: 6 });
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;
        await selectRow(page, 0);
        await selectRow(page, 1);

        paginator(fixture)._changePageSize(25);
        await settlePage();
        tracksRequest({ limit: '25' }).flush({ items: [track(1), track(2), track(3)], total: 6 });
        await settlePage();
        expect(checked(page)).toBe(2);

        header(page, 'title')?.click();
        await settlePage();
        tracksRequest({ order: 'desc' }).flush({
          items: [track(6), track(5), track(4)],
          total: 6,
        });
        await settlePage();
        expect(checked(page)).toBe(0);
        const all = page.querySelector<HTMLElement>('th mat-checkbox');
        expect(all?.classList).not.toContain('mat-mdc-checkbox-checked');
        await selectRow(page, 0);
        const component = fixture.componentInstance as unknown as {
          selected(): ReadonlyMap<number, unknown>;
          filters: { controls: { quality: { setValue(value: string): void } } };
        };
        expect([...component.selected().keys()]).toEqual([1, 2, 6]);

        // The header checkbox takes the current page only.
        page.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
        await settlePage();
        expect([...component.selected().keys()].sort()).toEqual([1, 2, 4, 5, 6]);
        page.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
        await settlePage();
        expect([...component.selected().keys()]).toEqual([1, 2]);

        component.filters.controls.quality.setValue('issues');
        await new Promise((resolve) => setTimeout(resolve, LIBRARY_SEARCH_DEBOUNCE_MS));
        await settlePage();
        tracksRequest({ quality: 'issues', offset: '0' }).flush({ items: [], total: 0 });
        await settlePage();
        expect(component.selected().size).toBe(0);
      });

      it('refreshes the selected tracks on the read page and keeps the others', async () => {
        TestBed.inject(RealtimeService).connect();
        server.latest.open();
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1), track(2)], total: 60 });
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;
        await selectRow(page, 0);
        pageButton(page, 'next')?.click();
        tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 60 });
        await settlePage();
        await selectRow(page, 0);

        server.latest.send({
          type: 'transcode.completed',
          time: '2026-10-16T08:00:00Z',
          operation_id: 9,
          data: { kind: 'transcode', summary: '1 optimized' },
        });
        await settlePage();
        tracksRequest({ offset: '50' }).flush({
          items: [track(51, { title: 'Renamed', fixes: ['loudness'] })],
          total: 60,
        });
        await settlePage();

        const component = fixture.componentInstance as unknown as {
          selected(): ReadonlyMap<number, Track>;
        };
        expect(component.selected().get(51)?.title).toBe('Renamed');
        expect(component.selected().get(1)?.title).toBe('Song 1');
      });

      it('reads the same page again on Retry after a load error', async () => {
        const fixture = await createPage({ page: '2' });
        tracksRequest({ offset: '50' }).flush(
          { status: 500, code: 'internal_error', title: 'Internal Server Error', detail: 'down' },
          { status: 500, statusText: 'Internal Server Error' },
        );
        await settlePage();
        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('.load-error')?.textContent).toContain('down');

        button(page, 'common.retry')?.click();
        tracksRequest({ offset: '50', sort: 'title' }).flush({ items: [track(51)], total: 51 });
        await settlePage();
        expect(page.querySelector('.load-error')).toBeNull();
        expect(titles(page)).toEqual(['Song 51']);
      });

      it('searches after a pause in typing', async () => {
        vi.useFakeTimers();
        try {
          const fixture = TestBed.createComponent(LibraryPageComponent);
          TestBed.tick();
          http.expectOne('/api/playlists').flush({ items: [] });
          http.expectOne('/api/playlist-types').flush({ items: [] });
          tracksRequest({ limit: String(LIBRARY_DEFAULT_PAGE_SIZE) }).flush({
            items: [],
            total: 0,
          });

          const search = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
            'input[type="search"]',
          );
          if (!search) {
            throw new Error('No search field.');
          }
          search.value = 'night';
          search.dispatchEvent(new Event('input'));
          vi.advanceTimersByTime(LIBRARY_SEARCH_DEBOUNCE_MS - 1);
          http.expectNone((req) => req.url === '/api/tracks');
          vi.advanceTimersByTime(1);
          tracksRequest({ q: 'night' }).flush({ items: [], total: 0 });
        } finally {
          vi.useRealTimers();
        }
      });

      it('explains a refused delete of a track with play history', async () => {
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1)], total: 1 });
        await settlePage();

        button(fixture.nativeElement as HTMLElement, 'common.delete')?.click();
        await settlePage();
        button(overlay, 'common.delete')?.click();
        http.expectOne({ method: 'DELETE', url: '/api/tracks/1' }).flush(
          {
            status: 409,
            code: 'track_has_history',
            title: 'Conflict',
            detail: 'The track has aired and is kept for the played-tracks list.',
          },
          { status: 409, statusText: 'Conflict' },
        );
        await settlePage();
        expect(overlay.textContent).toContain('The track has aired');
      });
    });

    describe('TrackEditComponent', () => {
      it('creates a track, then sets its play rules, then returns to the library', async () => {
        const fixture = TestBed.createComponent(TrackEditComponent);
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        await settlePage();
        http.expectOne('/api/artists').flush({ items: [] });
        http.expectOne('/api/playlist-types').flush({ items: [] });
        http.expectOne('/api/playlists').flush({ items: [] });
        http.expectOne('/api/play-rules').flush({ items: [] });

        const component = fixture.componentInstance as unknown as {
          form: ReturnType<typeof trackForm>;
          save(): void;
        };
        component.form.patchValue({
          title: 'Station ID',
          type_id: 2,
          file_path: 'jingles/id.mp3',
          rule_ids: [4],
        });
        component.form.markAsDirty();
        component.save();

        const create = http.expectOne({ method: 'POST', url: '/api/tracks' });
        expect(create.request.body).toMatchObject({
          title: 'Station ID',
          type_id: 2,
          file_path: 'jingles/id.mp3',
        });
        create.flush(track(12, { title: 'Station ID' }));

        const rules = http.expectOne({ method: 'PUT', url: '/api/tracks/12/play-rules' });
        expect(rules.request.body).toEqual({ rule_ids: [4] });
        rules.flush({ rule_ids: [4] });
        await settlePage();

        expect(navigate).toHaveBeenCalledWith('/library');
      });

      it('keeps Save disabled while the path is outside the media root', async () => {
        const fixture = TestBed.createComponent(TrackEditComponent);
        await settlePage();
        http.match(() => true).forEach((request) => request.flush({ items: [] }));

        const component = fixture.componentInstance as unknown as {
          form: ReturnType<typeof trackForm>;
        };
        component.form.patchValue({ title: 'Song', type_id: 1, file_path: '/etc/passwd' });
        await settlePage();
        const save = button(fixture.nativeElement as HTMLElement, 'common.save');
        expect(save?.disabled).toBe(true);

        component.form.patchValue({ file_path: 'music/song.mp3' });
        await settlePage();
        expect(save?.disabled).toBe(false);
      });
    });
  });
});

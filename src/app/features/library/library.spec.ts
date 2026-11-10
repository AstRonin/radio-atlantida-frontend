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
import { I18nService } from '../../core/i18n/i18n.service';
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
import { LibraryCursorService } from './library-cursor';
import TrackEditComponent from './track-edit.component';
import { Track, createTrackBody, resetStoredForm, trackForm, updateTrackBody } from './track-form';

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
  in_use: null,
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
    it('sends metadata and playlists on update, without the file path, length, or analysis', () => {
      const stored = track(3, { quality_ok: false, quality_issues: ['loudness'] });
      const form = trackForm();
      resetStoredForm(form, stored);
      form.controls.title.setValue(' New title ');

      expect(form.controls.file_path.disabled).toBe(true);
      expect(form.controls.duration_ms.disabled).toBe(true);
      expect(updateTrackBody(form)).toEqual({
        title: 'New title',
        artist_id: 50,
        type_id: 1,
        quality_ok: false,
        quality_notes: '',
        playlist_ids: [],
      });
    });

    it('sends the file path and no length on create, so the backend reads the file', () => {
      const form = trackForm();
      form.patchValue({ title: 'Jingle', type_id: 2, file_path: 'jingles/id.mp3' });
      expect(createTrackBody(form)).toEqual({
        title: 'Jingle',
        artist_id: null,
        type_id: 2,
        file_path: 'jingles/id.mp3',
        duration_ms: null,
        quality_notes: '',
        playlist_ids: [],
      });
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
      // Tests of the rows leave the figures unanswered; the row's own tests answer them.
      http.match((req) => req.url === '/api/tracks/stats');
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

      describe('statistics row', () => {
        const figures = {
          total: 1234,
          reviewed: 1,
          with_issues: 2,
          unanalysed: 0,
          air_duration_ms: 5_400_000,
        };
        const statsRequest = () => http.expectOne((req) => req.url === '/api/tracks/stats');
        const noStatsRequest = () => http.expectNone((req) => req.url === '/api/tracks/stats');
        const shown = (page: HTMLElement) =>
          [...page.querySelectorAll('app-library-stats dd')].map((item) =>
            item.textContent?.trim(),
          );
        const figureButton = (page: HTMLElement, label: string) =>
          [...page.querySelectorAll<HTMLButtonElement>('app-library-stats button')].find((item) =>
            item.getAttribute('aria-label')?.includes(label),
          );
        const clearButton = (page: HTMLElement) => button(page, 'library.filters.clear');
        const afterDebounce = async () => {
          await new Promise((resolve) => setTimeout(resolve, LIBRARY_SEARCH_DEBOUNCE_MS));
          await settlePage();
        };

        type FilterControls = LibraryPageComponent['filters']['controls'];
        const controls = (fixture: ComponentFixture<LibraryPageComponent>) =>
          (fixture.componentInstance as unknown as { filters: { controls: FilterControls } })
            .filters.controls;

        async function openLoaded(params: Record<string, string> = {}) {
          const fixture = await createPage(params);
          tracksRequest({}).flush({ items: [track(1)], total: 120 });
          statsRequest().flush(figures);
          await settlePage();
          return { fixture, page: fixture.nativeElement as HTMLElement };
        }

        it('shows the figures of the response as plain and clickable values', async () => {
          const { page } = await openLoaded();
          expect(shown(page)).toEqual([
            '1,234',
            '1',
            '2',
            '0',
            'forms.interval.short.hoursMinutes',
          ]);
          expect(page.querySelector('app-library-stats dl')).not.toBeNull();
          expect(page.querySelector('app-library-stats [aria-live]')).toBeNull();
          expect(page.querySelectorAll('app-library-stats button')).toHaveLength(3);
          expect(figureButton(page, 'library.stats.apply')?.type).toBe('button');
        });

        it('names a figure button with its label and value, and shows hours and minutes', async () => {
          const i18n = TestBed.inject(I18nService);
          const texts = vi.spyOn(i18n, 'translate');
          const fixture = await createPage();
          tracksRequest({}).flush({ items: [], total: 0 });
          statsRequest().flush({ ...figures, air_duration_ms: 5_430_000 });
          await settlePage();

          expect(texts).toHaveBeenCalledWith('forms.interval.short.hoursMinutes', {
            hours: 1,
            minutes: 31,
          });
          expect(texts).toHaveBeenCalledWith('library.stats.apply', {
            label: 'library.stats.withIssues',
            value: '2',
          });
          fixture.destroy();
        });

        it('shows zero as zero, not as a dash', async () => {
          const fixture = await createPage();
          tracksRequest({}).flush({ items: [], total: 0 });
          statsRequest().flush({
            total: 0,
            reviewed: 0,
            with_issues: 0,
            unanalysed: 0,
            air_duration_ms: 0,
          });
          await settlePage();
          const values = shown(fixture.nativeElement as HTMLElement);
          expect(values.slice(0, 4)).toEqual(['0', '0', '0', '0']);
          expect(values[4]).toBe('forms.interval.short.minutes');
        });

        it('asks for the figures of the whole library on the first load', async () => {
          await createPage();
          tracksRequest({}).flush({ items: [], total: 0 });
          const request = statsRequest();
          expect(request.request.method).toBe('GET');
          expect(request.request.params.keys()).toEqual([]);
          request.flush(figures);
          await settlePage();
        });

        it('asks with the filters of the list, without its page and order', async () => {
          const { fixture } = await openLoaded();
          controls(fixture).type_id.setValue(3);
          controls(fixture).q.setValue(' night ');
          await afterDebounce();

          const list = tracksRequest({ type_id: '3', q: 'night', offset: '0' });
          const stats = statsRequest();
          expect(stats.request.params.keys().sort()).toEqual(['q', 'type_id']);
          expect(stats.request.params.get('type_id')).toBe('3');
          expect(stats.request.params.get('q')).toBe('night');
          list.flush({ items: [], total: 0 });
          stats.flush(figures);
          await settlePage();
        });

        it('does not ask again on a page or sort change', async () => {
          const { page } = await openLoaded();
          pageButton(page, 'next')?.click();
          await settlePage();
          tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 120 });
          noStatsRequest();

          header(page, 'artist')?.click();
          await settlePage();
          tracksRequest({ sort: 'artist', offset: '0' }).flush({ items: [track(1)], total: 120 });
          noStatsRequest();
          await settlePage();
        });

        it('shows dashes when the request fails and leaves the table working', async () => {
          const fixture = await createPage();
          const page = fixture.nativeElement as HTMLElement;
          tracksRequest({}).flush({ items: [track(1)], total: 1 });
          statsRequest().flush(
            { title: 'Failed', status: 500, code: 'internal' },
            { status: 500, statusText: 'Failed' },
          );
          await settlePage();

          expect(shown(page)).toEqual(Array(5).fill('library.stats.unknown'));
          expect(page.querySelectorAll('app-library-stats button')).toHaveLength(0);
          expect(titles(page)).toEqual(['Song 1']);
          expect(page.querySelector('.load-error')).toBeNull();
          expect(overlay.textContent).toBe('');
        });

        it('keeps the figures while loading and cancels the request in flight', async () => {
          const { fixture, page } = await openLoaded();
          controls(fixture).type_id.setValue(3);
          await afterDebounce();
          tracksRequest({ type_id: '3' }).flush({ items: [], total: 0 });
          const first = statsRequest();
          await settlePage();
          expect(shown(page)[0]).toBe('1,234');

          controls(fixture).type_id.setValue(4);
          await afterDebounce();
          tracksRequest({ type_id: '4' }).flush({ items: [], total: 0 });
          expect(first.cancelled).toBe(true);
          statsRequest().flush({ ...figures, total: 7 });
          await settlePage();
          expect(shown(page)[0]).toBe('7');
        });

        for (const [label, control, value, param] of [
          ['library.stats.reviewed', 'reviewed', 'true', { reviewed: 'true' }],
          ['library.stats.withIssues', 'quality', 'issues', { quality: 'issues' }],
          ['library.stats.notAnalysed', 'quality', 'unanalysed', { quality: 'unanalysed' }],
        ] as const) {
          it(`${label} sets its filter and goes to the first page`, async () => {
            const i18n = TestBed.inject(I18nService);
            vi.spyOn(i18n, 'translate').mockImplementation((key, params) =>
              params ? `${String(params['label'])}` : key,
            );
            const { fixture, page } = await openLoaded();
            pageButton(page, 'next')?.click();
            await settlePage();
            tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 120 });
            await settlePage();

            figureButton(page, label)?.click();
            await afterDebounce();

            expect(controls(fixture)[control].value).toBe(value);
            tracksRequest({ ...param, offset: '0' }).flush({ items: [], total: 0 });
            statsRequest().flush(figures);
            await settlePage();
          });
        }

        it('hides Clear filters without a filter and for a search of only spaces', async () => {
          const { fixture, page } = await openLoaded();
          expect(clearButton(page)).toBeUndefined();

          controls(fixture).q.setValue('   ');
          await settlePage();
          expect(clearButton(page)).toBeUndefined();
          await afterDebounce();
        });

        it('shows Clear filters for each filter', async () => {
          const { fixture, page } = await openLoaded();
          const filters = controls(fixture);
          const set: (() => void)[] = [
            () => filters.q.setValue('night'),
            () => filters.playlist_id.setValue(4),
            () => filters.type_id.setValue(1),
            () => filters.quality.setValue('ok'),
            () => filters.reviewed.setValue('false'),
            () => filters.in_plan.setValue('true'),
            () => filters.without_playlist.setValue(true),
          ];
          for (const apply of set) {
            apply();
            await settlePage();
            expect(clearButton(page)).toBeDefined();
            filters.q.setValue('');
            filters.playlist_id.setValue(null);
            filters.type_id.setValue(null);
            filters.quality.setValue(null);
            filters.reviewed.setValue(null);
            filters.in_plan.setValue(null);
            filters.without_playlist.setValue(false);
            await settlePage();
            expect(clearButton(page)).toBeUndefined();
          }
          await afterDebounce();
        });

        it('clears every filter with one read, keeps the page size and sort, and moves focus', async () => {
          const params = {
            quality: 'issues',
            reviewed: 'true',
            in_plan: 'false',
            in_playlist: 'false',
            size: '25',
            sort: 'artist',
            order: 'desc',
            page: '2',
          };
          const fixture = await createPage(params);
          const page = fixture.nativeElement as HTMLElement;
          tracksRequest({ quality: 'issues', offset: '25' }).flush({
            items: [track(1)],
            total: 40,
          });
          statsRequest().flush(figures);
          await settlePage();
          const filters = controls(fixture);
          filters.q.setValue('night');
          filters.playlist_id.setValue(4);
          filters.type_id.setValue(1);
          await afterDebounce();
          tracksRequest({ q: 'night' }).flush({ items: [], total: 40 });
          statsRequest().flush(figures);
          await settlePage();

          const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
          clearButton(page)?.click();
          await settlePage();

          expect(document.activeElement).toBe(page.querySelector('input[type="search"]'));
          expect(clearButton(page)).toBeUndefined();
          expect(filters.q.value).toBe('');
          expect(filters.without_playlist.value).toBe(false);
          for (const control of [
            filters.playlist_id,
            filters.type_id,
            filters.quality,
            filters.reviewed,
            filters.in_plan,
          ]) {
            expect(control.value).toBeNull();
          }

          await afterDebounce();
          const list = tracksRequest({ sort: 'artist', order: 'desc', offset: '0', limit: '25' });
          expect(list.request.params.keys().sort()).toEqual(['limit', 'offset', 'order', 'sort']);
          const stats = statsRequest();
          expect(stats.request.params.keys()).toEqual([]);
          list.flush({ items: [], total: 0 });
          stats.flush(figures);
          await settlePage();

          expect(navigate).toHaveBeenCalledTimes(1);
          expect(navigate).toHaveBeenCalledWith(
            [],
            expect.objectContaining({
              queryParams: expect.objectContaining({
                quality: null,
                reviewed: null,
                in_plan: null,
                in_playlist: null,
                size: 25,
                sort: 'artist',
                order: 'desc',
              }),
            }),
          );
        });
      });

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

      it('keeps the rows of the page in list order for Save and Next', async () => {
        await createPage();
        tracksRequest({ offset: '0', sort: 'title' }).flush({
          items: [track(7), track(2), track(9)],
          total: 3,
        });
        await settlePage();

        expect(TestBed.inject(LibraryCursorService).current()).toMatchObject({
          offset: 0,
          size: LIBRARY_DEFAULT_PAGE_SIZE,
          total: 3,
          trackIds: [7, 2, 9],
        });
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

      it('saves an edit without the file path, the length, or the analysis fields', async () => {
        const fixture = TestBed.createComponent(TrackEditComponent);
        fixture.componentRef.setInput('id', '3');
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        await settlePage();
        http.expectOne('/api/tracks/3').flush(track(3));
        await settlePage();
        http
          .match((req) => !req.url.startsWith('assets/'))
          .forEach((request) => request.flush({ items: [] }));
        await settlePage();

        const component = fixture.componentInstance as unknown as {
          form: ReturnType<typeof trackForm>;
          save(): void;
        };
        component.form.controls.title.setValue('Renamed');
        component.form.markAsDirty();
        component.save();

        const put = http.expectOne({ method: 'PUT', url: '/api/tracks/3' });
        expect(Object.keys(put.request.body as object).sort()).toEqual([
          'artist_id',
          'playlist_ids',
          'quality_notes',
          'quality_ok',
          'title',
          'type_id',
        ]);
        put.flush(track(3, { title: 'Renamed' }));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/library');
      });

      describe('Save and Next', () => {
        const cursorOf = (
          trackIds: number[],
          paging: { offset: number; size: number; total: number },
        ) => {
          TestBed.inject(LibraryCursorService).set({
            query: { sort: 'title', order: 'asc', offset: paging.offset, limit: paging.size },
            ...paging,
            trackIds,
          });
        };

        async function openEdit(id: number) {
          const fixture = TestBed.createComponent(TrackEditComponent);
          fixture.componentRef.setInput('id', String(id));
          await settlePage();
          http.expectOne(`/api/tracks/${id}`).flush(track(id));
          await settlePage();
          http
            .match((req) => !req.url.startsWith('assets/'))
            .forEach((request) => request.flush({ items: [] }));
          await settlePage();
          return fixture;
        }

        function saveAndNext(fixture: ComponentFixture<TrackEditComponent>) {
          const component = fixture.componentInstance as unknown as {
            form: ReturnType<typeof trackForm>;
            saveAndNext(): void;
          };
          component.form.controls.title.setValue('Renamed');
          component.form.markAsDirty();
          component.saveAndNext();
        }

        it('saves, then opens the next track of the list', async () => {
          cursorOf([3, 4, 5], { offset: 0, size: 50, total: 3 });
          const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
          const fixture = await openEdit(3);

          saveAndNext(fixture);
          http
            .expectOne({ method: 'PUT', url: '/api/tracks/3' })
            .flush(track(3, { title: 'Renamed' }));
          await settlePage();

          expect(navigate).toHaveBeenCalledWith(['/library', 4]);
        });

        it('stays on the last track of the list with a note', async () => {
          cursorOf([3], { offset: 0, size: 50, total: 1 });
          const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
          const fixture = await openEdit(3);

          saveAndNext(fixture);
          http
            .expectOne({ method: 'PUT', url: '/api/tracks/3' })
            .flush(track(3, { title: 'Renamed' }));
          await settlePage();
          http.expectOne('/api/tracks/3').flush(track(3, { title: 'Renamed' }));
          await settlePage();

          expect(navigate).not.toHaveBeenCalled();
          expect(fixture.nativeElement.textContent).toContain('library.edit.noNextTrack');
        });

        it('reads the next page in the same order when the track is its last row', async () => {
          cursorOf([3], { offset: 0, size: 1, total: 2 });
          const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
          const fixture = await openEdit(3);

          saveAndNext(fixture);
          http
            .expectOne({ method: 'PUT', url: '/api/tracks/3' })
            .flush(track(3, { title: 'Renamed' }));
          tracksRequest({ sort: 'title', order: 'asc', offset: '1', limit: '1' }).flush({
            items: [track(4)],
            total: 2,
          });
          await settlePage();

          expect(navigate).toHaveBeenCalledWith(['/library', 4]);
          expect(TestBed.inject(LibraryCursorService).current()).toMatchObject({
            offset: 1,
            trackIds: [4],
          });
        });

        it('stays on the form with the error when the save fails', async () => {
          cursorOf([3, 4], { offset: 0, size: 50, total: 2 });
          const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
          const fixture = await openEdit(3);

          saveAndNext(fixture);
          http.expectOne({ method: 'PUT', url: '/api/tracks/3' }).flush(
            {
              status: 500,
              code: 'internal_error',
              title: 'Internal Server Error',
              detail: 'down',
            },
            { status: 500, statusText: 'Internal Server Error' },
          );
          await settlePage();

          expect(navigate).not.toHaveBeenCalled();
          expect(fixture.nativeElement.querySelector('.form-error')?.textContent).toContain('down');
        });
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

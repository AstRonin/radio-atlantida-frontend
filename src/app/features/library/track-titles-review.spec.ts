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
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent, { LIBRARY_SEARCH_DEBOUNCE_MS } from './library-page.component';
import { LibraryListParams, readReviewedFilter } from './library-list-state';
import TrackEditComponent from './track-edit.component';
import { Track, cleanTitle, trackForm } from './track-form';

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
  quality_issues: [],
  quality_notes: 'quiet intro',
  fixes: [],
  play_rule_ids: [3],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  playlist_ids: [7, 8],
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  in_use: null,
  ...overrides,
});

const validationProblem = (field: string, code: string) => ({
  status: 422,
  code: 'validation_failed',
  title: 'Unprocessable Entity',
  detail: 'The request is not valid.',
  errors: [{ field, code, message: `${field} ${code}` }],
});

describe('track titles and the reviewed mark (F19)', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;

  beforeEach(() => {
    const server = new FakeSocketServer();
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
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.trim() === label,
    );
  const tracksRequest = (params: Record<string, string> = {}) =>
    http.expectOne(
      (req) =>
        req.url === '/api/tracks' &&
        Object.entries(params).every(([name, value]) => req.params.get(name) === value),
    );

  describe('title rule', () => {
    it('refuses control characters and white space alone, and cleans the title on send', () => {
      const title = trackForm().controls.title;
      title.setValue('Song\nB-side');
      expect(title.hasError('controlCharacters')).toBe(true);
      title.setValue('   ');
      expect(title.hasError('required')).toBe(true);
      title.setValue('Песня 🎉');
      expect(title.valid).toBe(true);
      expect(cleanTitle('  Night   Drive  ')).toBe('Night Drive');
    });

    it('reads the reviewed filter from the URL and ignores other values', () => {
      expect(readReviewedFilter('true')).toBe('true');
      expect(readReviewedFilter('false')).toBe('false');
      expect(readReviewedFilter('yes')).toBeNull();
      expect(readReviewedFilter('constructor')).toBeNull();
      expect(readReviewedFilter(undefined)).toBeNull();
    });
  });

  describe('LibraryPageComponent', () => {
    async function open(rows: Track[], params: LibraryListParams = {}, total = rows.length) {
      const fixture = TestBed.createComponent(LibraryPageComponent);
      for (const [name, value] of Object.entries(params)) {
        fixture.componentRef.setInput(name, value);
      }
      await settlePage();
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/playlist-types').flush({ items: [] });
      tracksRequest().flush({ items: rows, total });
      await settlePage();
      return fixture;
    }
    const page = (fixture: ComponentFixture<LibraryPageComponent>) =>
      fixture.nativeElement as HTMLElement;
    const renameButton = (root: HTMLElement) =>
      root.querySelector<HTMLButtonElement>(
        'td.mat-column-title button[aria-label="library.rename.button"]',
      );

    it('shows the reviewed mark with its station time and sorts by it', async () => {
      const fixture = await open([
        track(1, { reviewed_at: '2026-10-16T08:30:00Z' }),
        track(2, { reviewed_at: undefined }),
      ]);
      const root = page(fixture);
      const cells = root.querySelectorAll('td.mat-column-reviewed');
      const mark = cells[0].querySelector('.reviewed');
      expect(mark?.getAttribute('aria-label')).toContain('library.reviewedAt');
      expect(mark?.getAttribute('role')).toBe('img');
      expect(cells[1].querySelector('.reviewed')).toBeNull();

      root.querySelector<HTMLElement>('th.mat-column-reviewed')?.click();
      await settlePage();
      tracksRequest({ sort: 'reviewed', order: 'asc', offset: '0' }).flush({
        items: [],
        total: 0,
      });
    });

    it('filters by the mark, goes to page 1, clears the selection, and writes the URL', async () => {
      const fixture = await open([track(1), track(2)], { page: '2' });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const component = fixture.componentInstance as unknown as {
        selected(): ReadonlyMap<number, Track>;
        filters: { controls: { reviewed: { setValue(value: string): void } } };
      };
      page(fixture).querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
      await settlePage();
      expect(component.selected().size).toBe(2);

      component.filters.controls.reviewed.setValue('false');
      await new Promise((resolve) => setTimeout(resolve, LIBRARY_SEARCH_DEBOUNCE_MS));
      await settlePage();
      tracksRequest({ reviewed: 'false', offset: '0' }).flush({ items: [track(3)], total: 1 });
      await settlePage();
      expect(component.selected().size).toBe(0);
      expect(
        (fixture.debugElement.query(By.directive(MatPaginator)).componentInstance as MatPaginator)
          .pageIndex,
      ).toBe(0);
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ page: null, reviewed: 'false' }),
        }),
      );
    });

    it('opens with the reviewed filter of the URL', async () => {
      const fixture = TestBed.createComponent(LibraryPageComponent);
      fixture.componentRef.setInput('reviewed', 'true');
      await settlePage();
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/playlist-types').flush({ items: [] });
      tracksRequest({ reviewed: 'true' }).flush({ items: [], total: 0 });
    });

    it('marks the selected tracks of two pages with one request and keeps the found ones', async () => {
      const fixture = await open([track(1), track(2)], {}, 60);
      const root = page(fixture);
      root.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
      await settlePage();
      root.querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')?.click();
      tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 60 });
      await settlePage();
      root.querySelector<HTMLInputElement>('tr.mat-mdc-row mat-checkbox input')?.click();
      await settlePage();

      button(root, 'library.selection.markReviewed')?.click();
      await settlePage();
      const request = http.expectOne({ method: 'POST', url: '/api/tracks/review' });
      expect(request.request.body).toEqual({ track_ids: [1, 2, 51], reviewed: true });
      expect(button(root, 'library.selection.markUnreviewed')?.disabled).toBe(true);
      request.flush({ updated: [1, 51], not_found: [2] });
      await settlePage();
      tracksRequest({ offset: '50' }).flush({
        items: [track(51, { reviewed_at: '2026-10-16T09:00:00Z' })],
        total: 59,
      });
      await settlePage();

      const component = fixture.componentInstance as unknown as {
        selected(): ReadonlyMap<number, Track>;
      };
      expect([...component.selected().keys()]).toEqual([1, 51]);
      expect(root.textContent).toContain('library.selection.reviewNotFound');

      button(root, 'library.selection.markUnreviewed')?.click();
      await settlePage();
      const clear = http.expectOne({ method: 'POST', url: '/api/tracks/review' });
      expect(clear.request.body).toEqual({ track_ids: [1, 51], reviewed: false });
      clear.flush({ updated: [1, 51], not_found: [] });
      await settlePage();
      tracksRequest({ offset: '50' }).flush({ items: [track(51)], total: 59 });
    });

    describe('rename dialog', () => {
      async function openDialog(stored: Track) {
        const fixture = await open([stored]);
        renameButton(page(fixture))?.click();
        await settlePage();
        const input = overlay.querySelector<HTMLInputElement>('mat-dialog-container input');
        return { fixture, input };
      }
      async function type(input: HTMLInputElement | null, value: string) {
        if (!input) {
          throw new Error('No title field.');
        }
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await settlePage();
      }

      it('has a labelled row button and sends the whole track with the new title', async () => {
        const stored = track(4, { reviewed_at: '2026-10-15T08:00:00Z' });
        const { input } = await openDialog(stored);
        expect(input?.value).toBe('Song 4');
        await type(input, '  Night   Drive ');
        button(overlay, 'common.save')?.click();
        await settlePage();

        http.expectOne({ method: 'GET', url: '/api/tracks/4' }).flush(stored);
        const put = http.expectOne({ method: 'PUT', url: '/api/tracks/4' });
        // Metadata only: the file path, the length, and the analysis are refused by the update.
        expect(put.request.body).toEqual({
          title: 'Night Drive',
          artist_id: 50,
          type_id: 1,
          quality_notes: 'quiet intro',
          playlist_ids: [7, 8],
          quality_ok: true,
        });
        put.flush({ ...stored, title: 'Night Drive', reviewed_at: undefined });
        await settlePage();
        http.expectNone('/api/tracks/review');
        // The library reads the same page again.
        tracksRequest({ offset: '0' }).flush({ items: [track(4)], total: 1 });
        await settlePage();
        expect(overlay.querySelector('mat-dialog-container')).toBeNull();
      });

      it('marks the track reviewed after the rename when asked', async () => {
        const stored = track(4);
        const { input } = await openDialog(stored);
        await type(input, 'Night Drive');
        overlay.querySelector<HTMLInputElement>('mat-dialog-container mat-checkbox input')?.click();
        await settlePage();
        button(overlay, 'common.save')?.click();
        await settlePage();

        http.expectOne({ method: 'GET', url: '/api/tracks/4' }).flush(stored);
        http.expectOne({ method: 'PUT', url: '/api/tracks/4' }).flush(stored);
        const review = http.expectOne({ method: 'POST', url: '/api/tracks/review' });
        expect(review.request.body).toEqual({ track_ids: [4], reviewed: true });
        review.flush({ updated: [4], not_found: [] });
        await settlePage();
        tracksRequest().flush({ items: [track(4)], total: 1 });
      });

      it('puts the server error on the title field', async () => {
        const stored = track(4);
        const { input } = await openDialog(stored);
        await type(input, 'Night Drive');
        button(overlay, 'common.save')?.click();
        await settlePage();

        http.expectOne({ method: 'GET', url: '/api/tracks/4' }).flush(stored);
        http
          .expectOne({ method: 'PUT', url: '/api/tracks/4' })
          .flush(validationProblem('title', 'invalid_characters'), {
            status: 422,
            statusText: 'Unprocessable Entity',
          });
        await settlePage();
        expect(overlay.textContent).toContain('title invalid_characters');
        expect(overlay.querySelector('mat-dialog-container')).not.toBeNull();

        button(overlay, 'common.cancel')?.click();
        await settlePage();
        http.expectNone('/api/tracks');
      });

      it('keeps Save disabled for a title with a line break', async () => {
        const { input } = await openDialog(track(4));
        await type(input, 'Night\tDrive');
        expect(button(overlay, 'common.save')?.disabled).toBe(true);
      });
    });

    describe('bulk rename dialog', () => {
      async function openDialog(rows: Track[]) {
        const fixture = await open(rows);
        const root = page(fixture);
        root.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
        await settlePage();
        button(root, 'library.selection.rename')?.click();
        await settlePage();
        const inputs = overlay.querySelectorAll<HTMLInputElement>(
          'mat-dialog-container input:not([type=checkbox])',
        );
        return { fixture, find: inputs[0], replace: inputs[1] };
      }
      async function type(input: HTMLInputElement, value: string) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await settlePage();
      }
      const body = (find: string, dryRun: boolean) => ({
        track_ids: [1, 2, 3],
        find,
        replace: '',
        match_case: false,
        dry_run: dryRun,
      });

      it('previews, drops the preview on an edit, applies, and shows the answer', async () => {
        const rows = [
          track(1, { title: 'Song 1 [www.site.com]' }),
          track(2, { title: 'Song 2' }),
          track(3, { title: '[www.site.com]' }),
        ];
        const { fixture, find } = await openDialog(rows);
        expect(button(overlay, 'library.bulkRename.apply')?.disabled).toBe(true);

        await type(find, ' [www.site');
        button(overlay, 'library.bulkRename.preview')?.click();
        await settlePage();
        http
          .expectOne({ method: 'POST', url: '/api/tracks/rename' })
          .flush({ changed: [], unchanged: [1, 2, 3], refused: [] });
        await settlePage();
        // A preview without changes cannot be applied.
        expect(button(overlay, 'library.bulkRename.apply')?.disabled).toBe(true);

        await type(find, ' [www.site.com]');
        button(overlay, 'library.bulkRename.preview')?.click();
        await settlePage();
        const preview = http.expectOne({ method: 'POST', url: '/api/tracks/rename' });
        expect(preview.request.body).toEqual(body(' [www.site.com]', true));
        preview.flush({
          changed: [{ track_id: 1, old_title: 'Song 1 [www.site.com]', new_title: 'Song 1' }],
          unchanged: [2],
          refused: [{ track_id: 3, code: 'title_empty' }],
        });
        await settlePage();
        expect(overlay.textContent).toContain('Song 1 [www.site.com]');
        expect(overlay.textContent).toContain('problems.title_empty');
        expect(overlay.textContent).toContain('[www.site.com]:');
        expect(button(overlay, 'library.bulkRename.apply')?.disabled).toBe(false);

        // Any edit drops the preview, so Apply waits for a new one.
        await type(find, ' [www.site.co]');
        expect(button(overlay, 'library.bulkRename.apply')?.disabled).toBe(true);
        expect(overlay.textContent).not.toContain('problems.title_empty');
        await type(find, ' [www.site.com]');
        button(overlay, 'library.bulkRename.preview')?.click();
        await settlePage();
        http.expectOne({ method: 'POST', url: '/api/tracks/rename' }).flush({
          changed: [{ track_id: 1, old_title: 'Song 1 [www.site.com]', new_title: 'Song 1' }],
          unchanged: [2],
          refused: [{ track_id: 3, code: 'title_empty' }],
        });
        await settlePage();

        button(overlay, 'library.bulkRename.apply')?.click();
        await settlePage();
        const apply = http.expectOne({ method: 'POST', url: '/api/tracks/rename' });
        expect(apply.request.body).toEqual(body(' [www.site.com]', false));
        // Track 2 was renamed elsewhere in between and now matches; track 3 is gone.
        apply.flush({
          changed: [
            { track_id: 1, old_title: 'Song 1 [www.site.com]', new_title: 'Song 1' },
            { track_id: 2, old_title: 'Song 2 [www.site.com]', new_title: 'Song 2' },
          ],
          unchanged: [],
          refused: [{ track_id: 3, code: 'track_not_found' }],
        });
        await settlePage();
        expect(overlay.textContent).toContain('library.bulkRename.appliedTitle');
        expect(overlay.textContent).toContain('Song 2 [www.site.com]');
        expect(overlay.textContent).toContain('problems.track_not_found');
        expect(overlay.textContent).toContain('library.bulkRename.reviewNote');

        button(overlay, 'common.close')?.click();
        await settlePage();
        tracksRequest({ offset: '0' }).flush({ items: rows.slice(0, 2), total: 2 });
        await settlePage();
        const component = fixture.componentInstance as unknown as {
          selected(): ReadonlyMap<number, Track>;
        };
        expect([...component.selected().keys()]).toEqual([1, 2]);
      });

      it('shows field errors of the backend on the find field', async () => {
        const { find } = await openDialog([track(1), track(2), track(3)]);
        await type(find, 'x');
        button(overlay, 'library.bulkRename.preview')?.click();
        await settlePage();
        http
          .expectOne({ method: 'POST', url: '/api/tracks/rename' })
          .flush(validationProblem('find', 'invalid'), {
            status: 422,
            statusText: 'Unprocessable Entity',
          });
        await settlePage();
        expect(overlay.textContent).toContain('find invalid');
        button(overlay, 'common.cancel')?.click();
        await settlePage();
        tracksRequest().flush({ items: [], total: 0 });
      });
    });
  });

  describe('TrackEditComponent', () => {
    async function openEdit(stored: Track): Promise<ComponentFixture<TrackEditComponent>> {
      const fixture = TestBed.createComponent(TrackEditComponent);
      fixture.componentRef.setInput('id', String(stored.id));
      await settlePage();
      http.expectOne(`/api/tracks/${stored.id}`).flush(stored);
      await settlePage();
      http
        .match((req) => !req.url.startsWith('assets/'))
        .forEach((request) => request.flush({ items: [] }));
      await settlePage();
      return fixture;
    }
    const toggle = (root: HTMLElement) =>
      root.querySelector<HTMLButtonElement>('mat-slide-toggle button');

    it('sends the reviewed mark at once and leaves the form pristine', async () => {
      const fixture = await openEdit(track(5));
      const root = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance as unknown as {
        form: ReturnType<typeof trackForm>;
      };
      expect(root.textContent).toContain('library.edit.titleHint');
      expect(toggle(root)?.getAttribute('aria-checked')).toBe('false');

      toggle(root)?.click();
      await settlePage();
      const review = http.expectOne({ method: 'POST', url: '/api/tracks/review' });
      expect(review.request.body).toEqual({ track_ids: [5], reviewed: true });
      expect(component.form.dirty).toBe(false);
      review.flush({ updated: [5], not_found: [] });
      await settlePage();
      http
        .expectOne({ method: 'GET', url: '/api/tracks/5' })
        .flush(track(5, { reviewed_at: '2026-10-16T09:00:00Z' }));
      await settlePage();
      expect(toggle(root)?.getAttribute('aria-checked')).toBe('true');
      expect(root.textContent).toContain('library.reviewedAt');
      expect(component.form.dirty).toBe(false);
    });

    it('disables the mark while the form has unsaved changes', async () => {
      const fixture = await openEdit(track(5, { reviewed_at: '2026-10-16T09:00:00Z' }));
      const root = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance as unknown as {
        form: ReturnType<typeof trackForm>;
      };
      expect(toggle(root)?.disabled).toBe(false);
      component.form.controls.title.setValue('New title');
      component.form.markAsDirty();
      await settlePage();
      expect(toggle(root)?.disabled).toBe(true);
      expect(root.textContent).toContain('library.edit.reviewSaveFirst');
    });
  });
});

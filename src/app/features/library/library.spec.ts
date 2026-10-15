import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent, {
  LIBRARY_PAGE_SIZE,
  LIBRARY_SEARCH_DEBOUNCE_MS,
} from './library-page.component';
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

  describe('pages', () => {
    let http: HttpTestingController;
    let overlay: HTMLElement;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([apiProblemInterceptor])),
          provideHttpClientTesting(),
          provideRouter([]),
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
      async function createPage() {
        const fixture = TestBed.createComponent(LibraryPageComponent);
        await settlePage();
        http.expectOne('/api/playlists').flush({ items: [] });
        http.expectOne('/api/playlist-types').flush({ items: [] });
        return fixture;
      }

      it('lists tracks with a play button on every row and reads more pages', async () => {
        const fixture = await createPage();
        tracksRequest({ limit: String(LIBRARY_PAGE_SIZE) }).flush({
          items: [track(1), track(2, { duration_ms: undefined, quality_ok: undefined })],
          next_cursor: 'c1',
        });
        await settlePage();

        const page = fixture.nativeElement as HTMLElement;
        const rows = page.querySelectorAll('tr.mat-mdc-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('app-play-button')).not.toBeNull();
        expect(rows[1].querySelector('app-play-button')).not.toBeNull();
        expect(rows[1].textContent).toContain('library.noDuration');
        expect(rows[1].textContent).toContain('library.quality.unanalysed');

        button(page, 'common.loadMore')?.click();
        tracksRequest({ cursor: 'c1' }).flush({ items: [track(3)] });
        await settlePage();
        expect(page.querySelectorAll('tr.mat-mdc-row')).toHaveLength(3);
      });

      it('searches after a pause in typing', async () => {
        vi.useFakeTimers();
        try {
          const fixture = TestBed.createComponent(LibraryPageComponent);
          TestBed.tick();
          http.expectOne('/api/playlists').flush({ items: [] });
          http.expectOne('/api/playlist-types').flush({ items: [] });
          tracksRequest({ limit: String(LIBRARY_PAGE_SIZE) }).flush({ items: [] });

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
          tracksRequest({ q: 'night' }).flush({ items: [] });
        } finally {
          vi.useRealTimers();
        }
      });

      it('explains a refused delete of a track with play history', async () => {
        const fixture = await createPage();
        tracksRequest({}).flush({ items: [track(1)] });
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

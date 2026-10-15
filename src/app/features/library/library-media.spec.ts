import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent from './library-page.component';
import TrackEditComponent from './track-edit.component';
import { Track, trackBody, trackForm, trackFormValue } from './track-form';

const track = (id: number, overrides: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  duration_ms: 225_000,
  file_path: `music/${id}.wav`,
  format: 'wav',
  bitrate: 1_411_000,
  sample_rate: 48_000,
  channels: 2,
  codec: 'pcm_s16le',
  loudness_lufs: -9.24,
  true_peak_dbtp: 0.4,
  loudness_range_lu: 5.1,
  analyzed_at: '2026-10-15T08:00:00Z',
  quality_ok: false,
  quality_issues: ['format', 'sample_rate', 'loudness', 'true_peak'],
  fixes: ['loudness', 'optimize'],
  play_rule_ids: [],
  playlist_ids: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  ...overrides,
});

describe('library media actions', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;
  let overlay: HTMLElement;

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
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
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
  const tracksRequest = () => http.expectOne((req) => req.url === '/api/tracks');

  function completed(kind: 'analyse' | 'transcode', id: number, summary: string): void {
    server.latest.send({
      type: `${kind}.completed`,
      time: '2026-10-15T08:05:00Z',
      operation_id: id,
      data: { kind, summary },
    });
  }

  describe('LibraryPageComponent', () => {
    async function open(
      rows: Track[],
      quality?: string,
    ): Promise<{ fixture: ComponentFixture<LibraryPageComponent>; page: HTMLElement }> {
      const fixture = TestBed.createComponent(LibraryPageComponent);
      if (quality) {
        fixture.componentRef.setInput('quality', quality);
      }
      await settlePage();
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/playlist-types').flush({ items: [] });
      const request = tracksRequest();
      request.flush({ items: rows });
      await settlePage();
      return { fixture, page: fixture.nativeElement as HTMLElement };
    }

    async function selectRow(page: HTMLElement, index: number): Promise<void> {
      page
        .querySelectorAll('tr.mat-mdc-row')
        [index].querySelector<HTMLInputElement>('mat-checkbox input')
        ?.click();
      await settlePage();
    }

    it('fixes only the selected tracks that list the fix, then clears and reloads', async () => {
      const { page } = await open([
        track(1),
        track(2, { quality_issues: ['loudness'], fixes: ['loudness'] }),
        track(3, { quality_ok: true, quality_issues: [], fixes: [] }),
      ]);
      expect(page.querySelector('app-track-media-actions')).toBeNull();

      await selectRow(page, 0);
      await selectRow(page, 1);
      await selectRow(page, 2);
      expect(page.textContent).toContain('library.media.selected');
      // The labels carry the counts as parameters; check what each button would send instead.
      button(page, 'library.media.optimizeCount')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/transcode' });
      expect(start.request.body).toEqual({ track_ids: [1], fix: 'optimize', output: 'copy' });
      start.flush({ operation_id: 51 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'library.media.analyse')?.disabled).toBe(true);

      completed('transcode', 51, '1 optimized');
      await settlePage();
      // One reload for the own operation; the event's reload replaces it.
      const reloads = http.match((req) => req.url === '/api/tracks');
      expect(reloads.length).toBeGreaterThan(0);
      reloads.at(-1)?.flush({ items: [track(1, { format: 'mp3', fixes: [] })] });
      await settlePage();
      expect(page.textContent).toContain('1 optimized');
      expect(
        page.querySelectorAll('tr.mat-mdc-row mat-checkbox.mat-mdc-checkbox-checked'),
      ).toHaveLength(0);
    });

    it('sends the tracks with loudness fixes and disables a fix no selected track has', async () => {
      const { page } = await open([
        track(1, { quality_issues: ['low_bitrate'], fixes: [] }),
        track(2, { quality_issues: ['loudness'], fixes: ['loudness', 'optimize'] }),
      ]);
      await selectRow(page, 0);
      expect(button(page, 'library.media.fixLoudnessCount')?.disabled).toBe(true);
      expect(page.textContent).toContain('library.media.lowBitrate');

      await selectRow(page, 1);
      button(page, 'library.media.fixLoudnessCount')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/transcode' });
      expect(start.request.body).toEqual({ track_ids: [2], fix: 'loudness', output: 'copy' });
      start.flush({ operation_id: 52 }, { status: 202, statusText: 'Accepted' });
    });

    it('asks before replacing the original files', async () => {
      const { fixture, page } = await open([track(1)]);
      await selectRow(page, 0);
      const actions = fixture.debugElement.query((node) => node.name === 'app-track-media-actions')
        .componentInstance as { output: { setValue(value: string): void } };
      actions.output.setValue('replace');

      button(page, 'library.media.optimizeCount')?.click();
      await settlePage();
      expect(overlay.textContent).toContain('library.media.replaceDialog.title');
      button(overlay, 'common.cancel')?.click();
      await settlePage();
      http.expectNone('/api/tracks/transcode');

      button(page, 'library.media.optimizeCount')?.click();
      await settlePage();
      button(overlay, 'library.media.replaceDialog.confirm')?.click();
      await settlePage();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/transcode' });
      expect(start.request.body).toEqual({ track_ids: [1], fix: 'optimize', output: 'replace' });
      start.flush({ operation_id: 53 }, { status: 202, statusText: 'Accepted' });
    });

    it('analyses every selected track again, decoding when asked, and shows a refusal', async () => {
      const { page } = await open([track(1), track(2, { quality_ok: true, fixes: [] })]);
      page.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
      await settlePage();
      page.querySelector<HTMLInputElement>('app-track-media-actions mat-checkbox input')?.click();
      await settlePage();

      button(page, 'library.media.analyse')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/analyse' });
      expect(start.request.body).toEqual({ track_ids: [1, 2], force: true });
      start.flush(
        {
          status: 503,
          code: 'media_tools_unavailable',
          title: 'Service Unavailable',
          detail: 'ffmpeg is not installed.',
        },
        { status: 503, statusText: 'Service Unavailable' },
      );
      await settlePage();
      expect(page.querySelector('.form-error')?.textContent).toContain('ffmpeg is not installed.');
      expect(button(page, 'library.media.analyse')?.disabled).toBe(false);
    });

    it('opens with the quality filter from the query parameter', async () => {
      TestBed.createComponent(LibraryPageComponent).componentRef.setInput('quality', 'issues');
      await settlePage();
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/playlist-types').flush({ items: [] });
      const request = tracksRequest();
      expect(request.request.params.get('quality')).toBe('issues');
      request.flush({ items: [] });
    });

    it('reads the list again when an import ends', async () => {
      await open([]);
      server.latest.send({
        type: 'import.completed',
        time: '2026-10-15T08:05:00Z',
        operation_id: 60,
        data: { kind: 'import', summary: '3 imported' },
      });
      await settlePage();
      tracksRequest().flush({ items: [track(1)] });
    });
  });

  describe('TrackEditComponent', () => {
    async function open(stored: Track): Promise<ComponentFixture<TrackEditComponent>> {
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

    it('shows the measurements and explains each issue', async () => {
      const fixture = await open(track(3));
      const page = fixture.nativeElement as HTMLElement;
      const facts = page.querySelector('app-track-analysis')?.textContent ?? '';
      expect(facts).toContain('pcm_s16le');
      expect(facts).toContain('library.analysis.lufs');
      expect(page.querySelectorAll('app-track-analysis li')).toHaveLength(4);
      expect(page.textContent).toContain('library.quality.explain.true_peak');
    });

    it('keeps the fixes off while the form has changes', async () => {
      const fixture = await open(track(3));
      const page = fixture.nativeElement as HTMLElement;
      expect(button(page, 'library.media.optimize')?.disabled).toBe(false);

      const view = fixture.componentInstance as unknown as {
        form: ReturnType<typeof trackForm>;
      };
      view.form.controls.title.setValue('Changed');
      view.form.markAsDirty();
      await settlePage();
      expect(button(page, 'library.media.optimize')?.disabled).toBe(true);
      expect(page.textContent).toContain('library.media.saveFirst');
    });

    it('reads the track again after a fix, so the form has the new path', async () => {
      const fixture = await open(track(3));
      const page = fixture.nativeElement as HTMLElement;

      button(page, 'library.media.fixLoudness')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/transcode' });
      expect(start.request.body).toEqual({ track_ids: [3], fix: 'loudness', output: 'copy' });
      start.flush({ operation_id: 54 }, { status: 202, statusText: 'Accepted' });
      await settlePage();

      completed('transcode', 54, '1 fixed');
      await settlePage();
      http
        .expectOne('/api/tracks/3')
        .flush(track(3, { file_path: 'music/3.optimal.wav', fixes: ['optimize'] }));
      await settlePage();

      const view = fixture.componentInstance as unknown as {
        form: ReturnType<typeof trackForm>;
      };
      expect(view.form.controls.file_path.value).toBe('music/3.optimal.wav');
      expect(page.textContent).toContain('1 fixed');
    });
  });

  it('sends the quality override from the form', () => {
    const stored = track(3);
    const form = trackForm();
    form.reset(trackFormValue(stored));
    expect(trackBody(form, stored).quality_ok).toBe(false);
    form.controls.quality_ok.setValue(true);
    expect(trackBody(form, stored).quality_ok).toBe(true);
    expect(trackBody(form, null)).not.toHaveProperty('quality_ok');
  });
});

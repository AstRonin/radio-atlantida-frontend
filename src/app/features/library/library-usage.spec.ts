import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent, {
  LIBRARY_ANALYSIS_RELOAD_MS,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  LIBRARY_USAGE_RELOAD_MS,
} from './library-page.component';
import { readInPlanFilter, readWithoutPlaylist } from './library-list-state';
import { Track } from './track-form';
import { cueResetNote } from './track-media';

const track = (id: number, overrides: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  duration_ms: 245_300,
  air_duration_ms: 245_300,
  file_path: `music/${id}.mp3`,
  format: 'mp3',
  quality_ok: true,
  quality_issues: [],
  quality_notes: '',
  fixes: [],
  play_rule_ids: [],
  playlist_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  in_use: null,
  ...overrides,
});

describe('library usage marks (F20)', () => {
  let http: HttpTestingController;
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
  });

  afterEach(() => {
    vi.useRealTimers();
    flushHelp(http);
    // Tests of the rows leave the figures unanswered; the row's own tests answer them.
    http.match((req) => req.url === '/api/tracks/stats');
    http.verify();
  });

  const tracksRequest = (params: Record<string, string | null> = {}) =>
    http.expectOne(
      (req) =>
        req.url === '/api/tracks' &&
        Object.entries(params).every(([name, value]) => req.params.get(name) === value),
    );

  async function open(rows: Track[], inputs: Record<string, string> = {}) {
    const fixture = TestBed.createComponent(LibraryPageComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await settlePage();
    http.expectOne('/api/playlists').flush({
      items: [
        {
          id: 4,
          name: 'Morning',
          track_count: 1,
          play_rule_ids: [],
          created_at: '2026-10-01T00:00:00Z',
          type: { id: 1, code: 'music', name: 'Music' },
        },
        {
          id: 5,
          name: 'Evening',
          track_count: 1,
          play_rule_ids: [],
          created_at: '2026-10-01T00:00:00Z',
          type: { id: 1, code: 'music', name: 'Music' },
        },
      ],
    });
    http.expectOne('/api/playlist-types').flush({ items: [] });
    tracksRequest().flush({ items: rows, total: rows.length });
    await settlePage();
    return fixture;
  }
  const cell = (fixture: ComponentFixture<LibraryPageComponent>, column: string, row = 0) =>
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      `tr.mat-mdc-row td.mat-column-${column}`,
    )[row];

  it('reads the reset cue points from an analysis summary', () => {
    expect(cueResetNote('analysed 2; cue_reset 1: [library/b.mp3]')).toEqual({
      count: 1,
      paths: 'library/b.mp3',
    });
    expect(cueResetNote('analysed 2')).toBeNull();
    expect(cueResetNote(undefined)).toBeNull();
  });

  it('reads the usage filters from the URL', () => {
    expect(readInPlanFilter('true')).toBe('true');
    expect(readInPlanFilter('false')).toBe('false');
    expect(readInPlanFilter('soon')).toBeNull();
    expect(readWithoutPlaylist('false')).toBe(true);
    expect(readWithoutPlaylist('true')).toBe(false);
    expect(readWithoutPlaylist(undefined)).toBe(false);
  });

  it('shows the next planned start, on air or queued, and the playlists of a row', async () => {
    const fixture = await open([
      track(1, {
        next_planned_at: '2026-10-16T10:15:00Z',
        playout_state: 'on_air',
        playlist_ids: [4, 5],
      }),
      track(2, { playout_state: 'queued' }),
      track(3),
    ]);

    // Station time, Asia/Yerevan: UTC+4.
    expect(cell(fixture, 'inPlan', 0).textContent).toContain('2:15');
    expect(cell(fixture, 'inPlan', 2).textContent?.trim()).toBe('');
    expect(cell(fixture, 'title', 0).querySelector('.playout')?.getAttribute('aria-label')).toBe(
      'library.usage.on_air',
    );
    expect(cell(fixture, 'title', 1).querySelector('.playout')?.getAttribute('aria-label')).toBe(
      'library.usage.queued',
    );
    expect(cell(fixture, 'title', 2).querySelector('.playout')).toBeNull();

    const playlists = cell(fixture, 'playlists', 0).querySelector('span');
    expect(playlists?.textContent?.trim()).toBe('2');
    expect(playlists?.getAttribute('aria-label')).toBe('library.usage.playlists');
    expect(cell(fixture, 'playlists', 2).textContent?.trim()).toBe('0');
  });

  it('shows the length on air and marks a cut track', async () => {
    const fixture = await open([track(1, { air_duration_ms: 221_560, cue_out_ms: 226_560 })]);
    const duration = cell(fixture, 'duration');
    expect(duration.textContent).toContain('3:41');
    expect(duration.textContent).not.toContain('4:05');
    expect(duration.querySelector('.cut')?.getAttribute('aria-label')).toBe('library.usage.cut');
  });

  it('sorts by the next planned start on the backend', async () => {
    const fixture = await open([track(1)]);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('th.mat-column-inPlan')
      ?.click();
    tracksRequest({ sort: 'next_planned_at', order: 'asc', offset: '0' }).flush({
      items: [track(1)],
      total: 1,
    });
    await settlePage();
  });

  it('filters by the plan and by no playlist, in the request and the URL', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await open([track(1)]);
    const filters = (
      fixture.componentInstance as unknown as {
        filters: { patchValue(value: object): void };
      }
    ).filters;

    filters.patchValue({ in_plan: 'false', without_playlist: true });
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_SEARCH_DEBOUNCE_MS + 20));
    await settlePage();
    tracksRequest({ in_plan: 'false', in_playlist: 'false', offset: '0' }).flush({
      items: [],
      total: 0,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ in_plan: 'false', in_playlist: 'false' }),
      }),
    );
  });

  it('opens with the filters from the URL', async () => {
    const fixture = TestBed.createComponent(LibraryPageComponent);
    fixture.componentRef.setInput('in_plan', 'true');
    fixture.componentRef.setInput('in_playlist', 'false');
    await settlePage();
    http.expectOne('/api/playlists').flush({ items: [] });
    http.expectOne('/api/playlist-types').flush({ items: [] });
    tracksRequest({ in_plan: 'true', in_playlist: 'false' }).flush({ items: [], total: 0 });
    await settlePage();
  });

  describe('following the air', () => {
    const isTracks = (req: HttpRequest<unknown>) => req.url === '/api/tracks';
    const isStats = (req: HttpRequest<unknown>) => req.url === '/api/tracks/stats';
    const FIGURES = { total: 1, reviewed: 0, with_issues: 0, unanalysed: 0, air_duration_ms: 1 };

    /** The page with the realtime stream open and its first figures answered. */
    async function openLive(rows: Track[], inputs: Record<string, string> = {}) {
      TestBed.inject(RealtimeService).connect();
      server.latest.open();
      const fixture = await open(rows, inputs);
      http.expectOne(isStats).flush(FIGURES);
      await settlePage();
      return fixture;
    }

    const nowPlaying = (id: number, source: 'plan' | 'emergency') => ({
      type: 'playout.now_playing',
      time: '2026-10-16T10:00:00Z',
      data: {
        track_id: id,
        ...(source === 'plan' ? { item_id: 900 + id } : {}),
        title: `Song ${id}`,
        source,
        started_at: '2026-10-16T10:00:00Z',
        in_ms: 0,
        out_ms: 245_300,
        truncated: false,
      },
    });

    const trackEnded = (id: number) => ({
      type: 'playout.track_ended',
      time: '2026-10-16T10:04:05Z',
      data: {
        track_id: id,
        source: 'emergency',
        status: 'aired',
        started_at: '2026-10-16T10:00:00Z',
        ended_at: '2026-10-16T10:04:05Z',
        actual_duration_ms: 245_300,
      },
    });

    const completed = (kind: string) => ({
      type: `${kind}.completed`,
      time: '2026-10-16T10:00:01Z',
      operation_id: 31,
      data: { kind, summary: 'done' },
    });

    /** Sends the events and lets the debounce of the usage reload pass. */
    async function sendAndWait(...events: Record<string, unknown>[]) {
      vi.useFakeTimers();
      events.forEach((event) => server.latest.send(event));
      vi.advanceTimersByTime(LIBRARY_USAGE_RELOAD_MS + 10);
      vi.useRealTimers();
      await settlePage();
    }

    const mark = (fixture: ComponentFixture<LibraryPageComponent>, row: number) =>
      cell(fixture, 'title', row).querySelector('.playout')?.getAttribute('aria-label') ?? null;

    it('moves the mark to an emergency track without a request', async () => {
      const fixture = await openLive([track(1, { playout_state: 'on_air' }), track(2)]);

      await sendAndWait(nowPlaying(2, 'emergency'));

      http.expectNone(isTracks);
      http.expectNone(isStats);
      expect(mark(fixture, 0)).toBeNull();
      expect(mark(fixture, 1)).toBe('library.usage.on_air');
    });

    it('clears the mark when the new track is not on the page', async () => {
      const fixture = await openLive([track(1, { playout_state: 'on_air' }), track(2)]);

      await sendAndWait(nowPlaying(99, 'emergency'));

      http.expectNone(isTracks);
      expect(mark(fixture, 0)).toBeNull();
      expect(mark(fixture, 1)).toBeNull();
    });

    it('keeps the queued mark of the other rows when the mark moves', async () => {
      const fixture = await openLive([
        track(1, { playout_state: 'on_air' }),
        track(2),
        track(3, { playout_state: 'queued' }),
      ]);

      await sendAndWait(nowPlaying(2, 'emergency'));

      expect(mark(fixture, 2)).toBe('library.usage.queued');
    });

    it('clears the mark at the end of that track, with no request', async () => {
      const fixture = await openLive([track(1, { playout_state: 'on_air' })]);

      await sendAndWait(trackEnded(1));

      http.expectNone(isTracks);
      http.expectNone(isStats);
      expect(mark(fixture, 0)).toBeNull();
    });

    it('keeps the mark when a late end belongs to another track', async () => {
      const fixture = await openLive([track(1), track(2, { playout_state: 'on_air' })]);

      await sendAndWait(trackEnded(1));

      http.expectNone(isTracks);
      expect(mark(fixture, 1)).toBe('library.usage.on_air');
    });

    it('reads the page alone once after a planned track starts', async () => {
      const fixture = await openLive([track(1), track(2, { playout_state: 'on_air' })]);

      vi.useFakeTimers();
      server.latest.send(nowPlaying(1, 'plan'));
      vi.advanceTimersByTime(LIBRARY_USAGE_RELOAD_MS - 10);
      http.expectNone(isTracks);
      vi.advanceTimersByTime(20);
      vi.useRealTimers();
      await settlePage();

      // The mark does not wait for the read.
      expect(mark(fixture, 0)).toBe('library.usage.on_air');
      http
        .expectOne(isTracks)
        .flush({ items: [track(1, { playout_state: 'on_air' }), track(2)], total: 2 });
      http.expectNone(isStats);
      await settlePage();
    });

    it('reads the figures too on a planned start when the in_plan filter is on', async () => {
      await openLive([track(1)], { in_plan: 'true' });

      await sendAndWait(nowPlaying(1, 'plan'));

      tracksRequest({ in_plan: 'true' }).flush({ items: [track(1)], total: 1 });
      const stats = http.expectOne(isStats);
      expect(stats.request.params.get('in_plan')).toBe('true');
      stats.flush(FIGURES);
      await settlePage();
    });

    it('reads the page and the figures once after a planned start and a plan event', async () => {
      await openLive([track(1)]);

      await sendAndWait(nowPlaying(1, 'plan'), completed('clock_build'));

      http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
      http.expectOne(isStats).flush(FIGURES);
      await settlePage();
    });

    it('does not carry a plan event over to a later planned start', async () => {
      await openLive([track(1)]);

      await sendAndWait(completed('track_plan'));
      http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
      http.expectOne(isStats).flush(FIGURES);
      await settlePage();

      await sendAndWait(nowPlaying(1, 'plan'));
      http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
      http.expectNone(isStats);
      await settlePage();
    });

    it.each(['import', 'analyse', 'transcode'])(
      'reloads the page and the figures at once on %s.completed',
      async (kind) => {
        await openLive([track(1)]);

        server.latest.send(completed(kind));
        await settlePage();

        http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
        http.expectOne(isStats).flush(FIGURES);
        await settlePage();
      },
    );

    it('reloads the page and the figures at once on track.analysed', async () => {
      await openLive([track(1)]);

      server.latest.send({
        type: 'track.analysed',
        time: '2026-10-16T10:00:00Z',
        data: { track_id: 1, quality_issues: [] },
      });
      await settlePage();

      http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
      http.expectOne(isStats).flush(FIGURES);
      await settlePage();
    });

    it.each(['track_plan', 'clock_build', 'reschedule', 'missed_items'])(
      'reloads the page and the figures after the debounce on %s.completed',
      async (kind) => {
        await openLive([track(1)]);

        await sendAndWait(completed(kind));

        http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
        http.expectOne(isStats).flush(FIGURES);
        await settlePage();
      },
    );

    it('keeps the row element on a reload and shows the new values', async () => {
      const fixture = await openLive([track(1)]);
      const row = (fixture.nativeElement as HTMLElement).querySelector('tr.mat-mdc-row');
      expect(row).not.toBeNull();

      await sendAndWait(nowPlaying(1, 'plan'));
      http.expectOne(isTracks).flush({
        items: [track(1, { title: 'Renamed', next_planned_at: '2026-10-16T10:15:00Z' })],
        total: 1,
      });
      await settlePage();

      expect((fixture.nativeElement as HTMLElement).querySelector('tr.mat-mdc-row')).toBe(row);
      expect(cell(fixture, 'title').textContent).toContain('Renamed');
      expect(cell(fixture, 'inPlan').textContent).toContain('2:15');
    });

    it('keeps the bar slot with and without the bar', async () => {
      const fixture = await openLive([track(1)]);
      const page = fixture.nativeElement as HTMLElement;
      const slot = () => page.querySelector('.load-slot');
      expect(slot()).not.toBeNull();
      expect(slot()?.querySelector('mat-progress-bar')).toBeNull();

      await sendAndWait(nowPlaying(1, 'plan'));
      expect(slot()?.querySelector('mat-progress-bar')).not.toBeNull();

      http.expectOne(isTracks).flush({ items: [track(1)], total: 1 });
      await settlePage();
      expect(slot()).not.toBeNull();
      expect(slot()?.querySelector('mat-progress-bar')).toBeNull();
    });
  });

  it('reads the figures again on a realtime event that reloads the list', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    await open([track(1)]);
    const first = http.expectOne((req) => req.url === '/api/tracks/stats');
    first.flush({ total: 1, reviewed: 0, with_issues: 0, unanalysed: 0, air_duration_ms: 245_300 });
    await settlePage();

    server.latest.send({
      type: 'analyse.completed',
      time: '2026-10-16T10:00:00Z',
      operation_id: 32,
      data: { kind: 'analyse', summary: 'analysed 1' },
    });
    await settlePage();

    tracksRequest().flush({ items: [track(1)], total: 1 });
    const second = http.expectOne((req) => req.url === '/api/tracks/stats');
    expect(second.request.params.keys()).toEqual([]);
    second.flush({
      total: 1,
      reviewed: 1,
      with_issues: 0,
      unanalysed: 0,
      air_duration_ms: 245_300,
    });
    await settlePage();
  });

  it('reads the page at once and then once per interval while an import analyses its tracks', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    await open([track(1)]);

    const reads = () => http.match((req) => req.url === '/api/tracks');
    vi.useFakeTimers();
    for (const id of [1, 2, 3, 4]) {
      server.latest.send({
        type: 'track.analysed',
        time: '2026-10-16T10:00:00Z',
        data: { track_id: id, quality_issues: [] },
      });
    }
    // The first event reads the page at once; the other three wait for the interval.
    const atOnce = reads();
    expect(atOnce).toHaveLength(1);
    atOnce.forEach((read) => read.flush({ items: [track(1)], total: 1 }));

    vi.advanceTimersByTime(LIBRARY_ANALYSIS_RELOAD_MS + 10);
    const afterInterval = reads();
    expect(afterInterval).toHaveLength(1);
    vi.useRealTimers();
    afterInterval.forEach((read) => read.flush({ items: [track(1)], total: 1 }));
    await settlePage();
  });
});

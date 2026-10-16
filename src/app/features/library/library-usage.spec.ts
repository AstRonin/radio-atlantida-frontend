import { provideHttpClient, withInterceptors } from '@angular/common/http';
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

  it('reads the page once after a burst of playout and plan events', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    await open([track(1)]);

    vi.useFakeTimers();
    server.latest.send({
      type: 'playout.now_playing',
      time: '2026-10-16T10:00:00Z',
      data: {
        track_id: 1,
        title: 'Song 1',
        source: 'plan',
        started_at: '2026-10-16T10:00:00Z',
        in_ms: 0,
        out_ms: 245_300,
        truncated: false,
      },
    });
    server.latest.send({
      type: 'clock_build.completed',
      time: '2026-10-16T10:00:01Z',
      operation_id: 31,
      data: { kind: 'clock_build', summary: 'built' },
    });
    vi.advanceTimersByTime(LIBRARY_USAGE_RELOAD_MS - 10);
    http.expectNone('/api/tracks');
    vi.advanceTimersByTime(20);
    vi.useRealTimers();
    await settlePage();
    tracksRequest().flush({ items: [track(1, { playout_state: 'on_air' })], total: 1 });
    await settlePage();
  });
});

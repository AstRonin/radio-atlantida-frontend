import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import AirWindowPageComponent, { RELOAD_DEBOUNCE_MS } from './air-window-page.component';

type AirWindow = ApiSchema<'AirWindow'>;

const WINDOW: AirWindow = {
  generated_at: '2026-10-15T10:01:00Z',
  control_link_connected: true,
  rows: [
    {
      kind: 'now',
      status: 'now',
      item_id: 14,
      track_id: 7,
      title: 'Current Song',
      artist_name: 'Ani',
      source: 'plan',
      start_utc: '2026-10-15T10:00:00Z',
      end_utc: '2026-10-15T10:04:00Z',
      truncated: false,
      resolution: null,
      outage_id: null,
      in_liquidsoap: true,
    },
  ],
};

// The data is not read by the page; any envelope of the type is enough.
const EVENT = { time: '2026-10-15T10:01:00Z', data: {} };

/** Every event that moves the window (docs/f15-air-window-plan.md §2.4). */
const RELOAD_EVENTS = [
  'playout.now_playing',
  'playout.track_ended',
  'liquidsoap.state',
  'track_plan.completed',
  'clock_build.completed',
  'reschedule.completed',
  'broadcast_outage.started',
  'broadcast_outage.ended',
  'missed_items.completed',
];

const afterDebounce = () => new Promise((resolve) => setTimeout(resolve, RELOAD_DEBOUNCE_MS + 50));

describe('AirWindowPageComponent', () => {
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
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
    flushHelp(http);
    http.verify();
  });

  async function open(): Promise<ComponentFixture<AirWindowPageComponent>> {
    const fixture = TestBed.createComponent(AirWindowPageComponent);
    await settlePage();
    http.expectOne('/api/air-window').flush(WINDOW);
    await settlePage();
    return fixture;
  }

  function send(type: string): void {
    server.latest.send({ type, ...EVENT });
  }

  it('loads the window without limits and shows its rows', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelectorAll('app-air-window-list tbody tr')).toHaveLength(1);
    expect(page.querySelector('tbody tr.now')?.textContent).toContain('Current Song');
  });

  it.each(RELOAD_EVENTS)('reloads on %s', async (type) => {
    const fixture = await open();

    send(type);
    await afterDebounce();
    await settlePage();
    http.expectOne('/api/air-window').flush({ ...WINDOW, rows: [] });
    await settlePage();

    // The rows stay on screen until the answer comes, then show what it says.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('airWindow.empty');
  });

  it('reloads once for an end followed at once by a start', async () => {
    await open();

    send('playout.track_ended');
    send('playout.now_playing');
    await afterDebounce();
    await settlePage();

    http.expectOne('/api/air-window').flush(WINDOW);
    await settlePage();
  });

  it('does not reload on an unrelated event', async () => {
    await open();

    send('import.completed');
    await afterDebounce();
    await settlePage();

    http.expectNone('/api/air-window');
  });

  it('replaces a request in flight, even the first one', async () => {
    TestBed.createComponent(AirWindowPageComponent);
    await settlePage();
    const first = http.expectOne('/api/air-window');

    send('playout.now_playing');
    await afterDebounce();
    await settlePage();

    expect(first.cancelled).toBe(true);
    http.expectOne('/api/air-window').flush(WINDOW);
    await settlePage();
  });

  it('shows a load error with a retry', async () => {
    const fixture = TestBed.createComponent(AirWindowPageComponent);
    await settlePage();
    http
      .expectOne('/api/air-window')
      .flush(
        { status: 500, title: 'Internal Server Error', detail: 'database unavailable' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await settlePage();

    const page = fixture.nativeElement as HTMLElement;
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Internal Server Error');
    expect(page.querySelector('app-air-window-list')).toBeNull();

    alert?.querySelector('button')?.click();
    await settlePage();
    http.expectOne('/api/air-window').flush(WINDOW);
    await settlePage();
    expect(page.querySelector('app-air-window-list')).not.toBeNull();
  });

  it('cancels the open request when the page is left', async () => {
    const fixture = TestBed.createComponent(AirWindowPageComponent);
    await settlePage();
    const request = http.expectOne('/api/air-window');

    fixture.destroy();

    expect(request.cancelled).toBe(true);
  });
});

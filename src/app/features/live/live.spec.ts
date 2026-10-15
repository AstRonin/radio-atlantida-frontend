import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { LIVE_MEDIA } from '../../core/live/live-browser';
import { LiveBackendState, LiveVoiceService } from '../../core/live/live-voice.service';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LivePageComponent from './live-page.component';
import { LiveVoiceComponent } from './live-voice.component';

type PlayoutStatus = ApiSchema<'PlayoutStatus'>;

const playout = (overrides: Partial<PlayoutStatus> = {}): PlayoutStatus => ({
  control_link: { connected: true, since: '2026-10-15T07:00:00Z' },
  output: { state: 'connected', since: '2026-10-15T07:00:00Z' },
  music_gain: 1,
  now_playing: {
    track_id: 7,
    item_id: 11,
    title: 'Morning Song',
    artist_name: 'Ani',
    source: 'plan',
    started_at: '2026-10-15T08:00:00Z',
    out_ms: 200_000,
    truncated: false,
  },
  queued: [
    {
      id: 12,
      track_id: 8,
      title: 'Next Song',
      planned_start_utc: '2026-10-15T08:03:20Z',
      planned_out_ms: 180_000,
      truncated: false,
      queue: 'hour_0',
    },
  ],
  ...overrides,
});

const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  );

describe('LivePageComponent', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T08:01:40Z'));
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        // The page is tested without a microphone; the voice controls have their own tests.
        { provide: LIVE_MEDIA, useValue: null },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(LiveVoiceService);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    http
      .expectOne('/api/live/status')
      .flush({ available: true, state: 'off', harbor_connected: false, packets: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    flushHelp(http);
    http.verify();
  });

  const expectStatus = (status: PlayoutStatus = playout()) =>
    http.expectOne({ method: 'GET', url: '/api/playout/status' }).flush(status);

  async function open(status = playout()): Promise<ComponentFixture<LivePageComponent>> {
    const fixture = TestBed.createComponent(LivePageComponent);
    await settlePage();
    expectStatus(status);
    await settlePage();
    return fixture;
  }

  it('shows what is on air with its progress and the queue', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Morning Song');
    expect(page.textContent).toContain('1:40 / 3:20');
    expect(page.querySelector('mat-progress-bar[mode="determinate"]')).not.toBeNull();
    expect(page.textContent).toContain('Next Song');
    expect(page.textContent).toContain('live.onAir.connected');
    // Without a secure context, the voice section explains why it offers no controls.
    expect(page.textContent).toContain('live.voice.insecure');
  });

  it('follows the playout events', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    server.latest.send({
      type: 'playout.now_playing',
      time: '2026-10-15T08:03:20Z',
      data: {
        track_id: 8,
        item_id: 12,
        title: 'Next Song',
        source: 'plan',
        started_at: '2026-10-15T08:03:20Z',
        out_ms: 180_000,
        truncated: false,
      },
    });
    await settlePage();
    expect(page.querySelector('.now-title')?.textContent).toContain('Next Song');
    // A start makes the backend push the next items, so the queue is read again.
    expectStatus(playout({ queued: [] }));

    server.latest.send({
      type: 'liquidsoap.state',
      time: '2026-10-15T08:04:00Z',
      data: { connected: false },
    });
    server.latest.send({
      type: 'icecast.state',
      time: '2026-10-15T08:04:01Z',
      data: { state: 'disconnected' },
    });
    await settlePage();
    expect(page.textContent).toContain('live.onAir.disconnected');
    expect(page.textContent).toContain('live.onAir.queueEmpty');
  });

  it('sets the music gain from a preset', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    button(page, 'live.gain.presets.off')?.click();
    const request = http.expectOne({ method: 'PUT', url: '/api/playout/music-gain' });
    expect(request.request.body).toEqual({ gain: 0 });
    request.flush({ gain: 0 });
    await settlePage();
    expect(page.querySelector('.value')?.textContent).toContain('0 %');
  });

  it('keeps the gain when the playout engine is not reachable', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    button(page, 'live.gain.presets.underVoice')?.click();
    http.expectOne({ method: 'PUT', url: '/api/playout/music-gain' }).flush(
      {
        status: 503,
        code: 'liquidsoap_unavailable',
        title: 'Service Unavailable',
        detail: 'liquidsoap is not connected',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settlePage();
    expect(page.textContent).toContain('liquidsoap is not connected');
    expect(page.querySelector('.value')?.textContent).toContain('100 %');
  });
});

describe('LiveVoiceComponent', () => {
  let goOnAir: ReturnType<typeof vi.fn>;
  let overlay: HTMLElement;

  beforeEach(() => {
    goOnAir = vi.fn().mockResolvedValueOnce('busy').mockResolvedValueOnce('started');
    const off: LiveBackendState = { state: 'off', sessionId: null, onAirSince: null, reason: null };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: LiveVoiceService,
          useValue: {
            supported: true,
            backend: signal(off),
            available: signal(true),
            microphone: signal('open'),
            inputs: signal([{ deviceId: 'mic-1', label: 'Desk microphone' }]),
            input: signal('mic-1'),
            level: signal({ level: 0.5, clipping: true }),
            phase: signal('idle'),
            endReason: signal(null),
            error: signal(null),
            onAir: signal(false),
            ownsSession: signal(false),
            goOnAir,
            stop: vi.fn(),
            openMicrophone: vi.fn(),
            closeMicrophone: vi.fn(),
          },
        },
      ],
    });
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => TestBed.inject(MatDialog).closeAll());

  it('shows the level and takes over a running session only after confirmation', async () => {
    const fixture = TestBed.createComponent(LiveVoiceComponent);
    await settlePage();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(element.textContent).toContain('live.voice.clipping');

    button(element, 'live.voice.goOnAir')?.click();
    await settlePage();
    expect(goOnAir).toHaveBeenCalledWith();
    expect(overlay.textContent).toContain('live.takeover.title');

    button(overlay, 'live.takeover.confirm')?.click();
    await settlePage();
    expect(goOnAir).toHaveBeenLastCalledWith(true);
  });
});

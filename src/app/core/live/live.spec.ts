import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiSchema } from '../api/api-types';
import { apiProblemInterceptor } from '../api/api.interceptors';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { FakeLiveBrowser } from './fake-live.testing';
import { LIVE_MEDIA, levelOf } from './live-browser';
import { ICE_GATHERING_TIMEOUT_MS, LiveVoiceService } from './live-voice.service';

const status = (overrides: Partial<ApiSchema<'LiveInput'>> = {}): ApiSchema<'LiveInput'> => ({
  available: true,
  state: 'off',
  harbor_connected: false,
  packets: 0,
  ...overrides,
});

describe('levelOf', () => {
  it('maps silence, a quiet signal, and full scale onto the meter', () => {
    expect(levelOf(new Float32Array(64))).toEqual({ level: 0, clipping: false });
    // A constant 0.1 is -20 dB: two thirds up a meter from -60 dB.
    expect(levelOf(new Float32Array(64).fill(0.1)).level).toBeCloseTo(2 / 3);
    expect(levelOf(new Float32Array(64).fill(1))).toEqual({ level: 1, clipping: true });
  });
});

describe('LiveVoiceService', () => {
  let browser: FakeLiveBrowser;
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let service: LiveVoiceService;

  function setUp(extra: unknown[] = [], initial = status()): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        server.provider,
        ...browser.providers,
        ...(extra as never[]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(LiveVoiceService);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    expectStatus(initial);
  }

  function expectStatus(answer: ApiSchema<'LiveInput'>): void {
    http.expectOne({ method: 'GET', url: '/api/live/status' }).flush(answer);
  }

  /** The session request, once the offer has been prepared asynchronously. */
  async function sessionRequest(): Promise<TestRequest> {
    return vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/live/session' }));
  }

  async function goOnAir(): Promise<void> {
    await service.openMicrophone();
    const started = service.goOnAir();
    (await sessionRequest()).flush({ session_id: 4, answer: 'v=0 answer' });
    expect(await started).toBe('started');
  }

  beforeEach(() => {
    browser = new FakeLiveBrowser();
    server = new FakeSocketServer();
  });

  afterEach(() => http.verify());

  it('offers nothing where the browser has no microphone', async () => {
    setUp([{ provide: LIVE_MEDIA, useValue: null }]);
    expect(service.supported).toBe(false);
    await service.openMicrophone();
    expect(service.microphone()).toBe('closed');
  });

  it('opens the microphone with voice processing and shows its level', async () => {
    setUp();
    await service.openMicrophone();

    expect(browser.media.constraints[0]).toEqual({
      audio: {
        deviceId: undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(service.microphone()).toBe('open');
    expect(service.input()).toBe('mic-1');
    expect(service.inputs()).toEqual([
      { deviceId: 'mic-1', label: 'Desk microphone' },
      { deviceId: 'mic-2', label: 'live.voice.inputNumber' },
    ]);
    await vi.waitFor(() => expect(service.level().level).toBeCloseTo(2 / 3));
    expect(http.match(() => true)).toEqual([]);

    service.closeMicrophone();
    expect(browser.media.streams[0].track.stopped).toBe(true);
    expect(browser.contexts[0].closed).toBe(true);
    expect(service.level().level).toBe(0);
  });

  it('explains a refused microphone', async () => {
    setUp();
    browser.media.failWith = 'NotAllowedError';
    await service.openMicrophone();

    expect(service.microphone()).toBe('closed');
    expect(service.error()).toBe('live.errors.denied');
  });

  it('sends the gathered offer and applies the answer', async () => {
    setUp();
    await service.openMicrophone();
    const started = service.goOnAir();
    expect(service.phase()).toBe('starting');

    const request = await sessionRequest();
    expect(request.request.body).toEqual({ offer: 'v=0 offer candidates', takeover: false });
    request.flush({ session_id: 4, answer: 'v=0 answer' });

    expect(await started).toBe('started');
    expect(browser.peer.tracks).toEqual([browser.media.streams[0].track]);
    expect(browser.peer.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(service.phase()).toBe('active');
  });

  it('sends what it has when gathering takes too long', async () => {
    browser.gatherAtOnce = false;
    setUp();
    await service.openMicrophone();
    vi.useFakeTimers();
    try {
      const started = service.goOnAir();
      await vi.advanceTimersByTimeAsync(ICE_GATHERING_TIMEOUT_MS);
      http
        .expectOne({ method: 'POST', url: '/api/live/session' })
        .flush({ session_id: 4, answer: 'v=0 answer' });
      expect(await started).toBe('started');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a running session, then takes it over when asked', async () => {
    setUp();
    await service.openMicrophone();
    const first = service.goOnAir();
    (await sessionRequest()).flush(
      { status: 409, code: 'live_session_active', title: 'Conflict' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(await first).toBe('busy');
    expect(browser.peer.closed).toBe(true);
    expect(service.phase()).toBe('idle');
    expect(service.error()).toBeNull();

    const second = service.goOnAir(true);
    const request = await sessionRequest();
    expect(request.request.body).toEqual({ offer: 'v=0 offer candidates', takeover: true });
    request.flush({ session_id: 5, answer: 'v=0 answer' });
    expect(await second).toBe('started');
  });

  it('stops the session and keeps the microphone', async () => {
    setUp();
    await goOnAir();

    service.stop();
    http.expectOne({ method: 'DELETE', url: '/api/live/session' }).flush(null);
    expect(browser.peer.closed).toBe(true);
    expect(service.phase()).toBe('idle');
    expect(service.microphone()).toBe('open');
  });

  it('closes its connection when the backend ends its session', async () => {
    setUp();
    await goOnAir();

    server.latest.send({
      type: 'live.state',
      time: '2026-10-15T08:00:00Z',
      data: { state: 'off', reason: 'dropout' },
    });
    expectStatus(status());

    expect(browser.peer.closed).toBe(true);
    expect(service.phase()).toBe('idle');
    expect(service.endReason()).toBe('dropout');
    expect(service.microphone()).toBe('open');
  });

  it('keeps its session when an off belongs to the session it took over', async () => {
    setUp();
    await goOnAir();

    server.latest.send({
      type: 'live.state',
      time: '2026-10-15T08:00:00Z',
      data: { state: 'off', reason: 'replaced' },
    });
    expectStatus(status({ state: 'connecting', session_id: 4 }));

    expect(browser.peer.closed).toBe(false);
    expect(service.phase()).toBe('active');
    expect(service.backend().state).toBe('connecting');
  });

  it('shows a session started elsewhere, read when the connection opens', () => {
    setUp([], status({ state: 'on_air', session_id: 9, on_air_since: '2026-10-15T07:59:00Z' }));

    expect(service.onAir()).toBe(true);
    expect(service.ownsSession()).toBe(false);
    expect(service.backend()).toEqual({
      state: 'on_air',
      sessionId: 9,
      onAirSince: '2026-10-15T07:59:00Z',
      reason: null,
    });
  });

  it('switches the input on air without a new session', async () => {
    setUp();
    await goOnAir();

    await service.openMicrophone('mic-2');
    expect(browser.peer.replaced).toEqual([browser.media.streams[1].track]);
    expect(browser.media.streams[0].track.stopped).toBe(true);
    expect(service.input()).toBe('mic-2');
    expect(service.phase()).toBe('active');
  });
});

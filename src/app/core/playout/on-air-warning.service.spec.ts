import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiProblemInterceptor } from '../api/api.interceptors';
import type { ApiSchema } from '../api/api-types';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { OnAirWarningService } from './on-air-warning.service';

type PlayoutStatus = ApiSchema<'PlayoutStatus'>;
type NowPlaying = NonNullable<PlayoutStatus['now_playing']>;

const TIME = '2026-11-10T10:00:00Z';

const track = (overrides: Partial<NowPlaying> = {}): NowPlaying => ({
  track_id: 7,
  title: 'Reserve Song',
  source: 'emergency',
  started_at: TIME,
  in_ms: 0,
  truncated: false,
  ...overrides,
});

const planTrack = track({ item_id: 11, title: 'Morning Song', source: 'plan' });

const status = (overrides: Partial<PlayoutStatus> = {}): PlayoutStatus => ({
  control_link: { connected: true },
  safety_on_air: false,
  queued: [],
  ...overrides,
});

describe('OnAirWarningService', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let service: OnAirWarningService;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        server.provider,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(OnAirWarningService);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const statusRequest = () => http.expectOne({ method: 'GET', url: '/api/playout/status' });

  const nowPlaying = (data: NowPlaying) =>
    server.latest.send({ type: 'playout.now_playing', time: TIME, data });

  const trackEnded = (source: 'plan' | 'emergency' = 'emergency') =>
    server.latest.send({
      type: 'playout.track_ended',
      time: TIME,
      data: {
        track_id: 7,
        source,
        status: 'aired',
        started_at: TIME,
        ended_at: TIME,
        actual_duration_ms: 1_000,
      },
    });

  const safety = (onAir: boolean) =>
    server.latest.send({
      type: 'playout.safety',
      time: TIME,
      data: onAir ? { on_air: true, since: TIME } : { on_air: false },
    });

  it('shows nothing while a plan track is on air', () => {
    expect(service.warning()).toBeNull();
    statusRequest().flush(status({ now_playing: planTrack }));
    expect(service.warning()).toBeNull();
  });

  it('reads an emergency track and the safety tone from the first status', () => {
    statusRequest().flush(status({ now_playing: track() }));
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });

    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.open();
    statusRequest().flush(status({ safety_on_air: true, safety_since: TIME }));
    expect(service.warning()).toEqual({ kind: 'safety' });
  });

  it('treats a status without safety_on_air as not on air', () => {
    const errors = vi.spyOn(console, 'error');
    const oldBackend: Partial<PlayoutStatus> = status({ now_playing: track() });
    delete oldBackend.safety_on_air;
    statusRequest().flush(oldBackend);
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
    expect(errors).not.toHaveBeenCalled();
  });

  it('shows an emergency track when it starts and stops when a plan track follows', () => {
    statusRequest().flush(status());
    nowPlaying(track());
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
    nowPlaying(planTrack);
    expect(service.warning()).toBeNull();
  });

  it('reads the status when the emergency track ends and clears the warning', () => {
    statusRequest().flush(status({ now_playing: track() }));
    trackEnded();
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
    statusRequest().flush(status());
    expect(service.warning()).toBeNull();
  });

  it('does not read the status when a track ends and no emergency is shown', () => {
    statusRequest().flush(status({ now_playing: planTrack }));
    trackEnded('plan');
    http.expectNone('/api/playout/status');
  });

  it('follows playout.safety on and off', () => {
    statusRequest().flush(status());
    safety(true);
    expect(service.warning()).toEqual({ kind: 'safety' });
    safety(false);
    expect(service.warning()).toBeNull();
  });

  it('reads the state again after a reconnect', () => {
    statusRequest().flush(status());
    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.open();
    statusRequest().flush(status({ now_playing: track({ title: 'Missed Start' }) }));
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Missed Start' });
  });

  it('puts the safety tone before the emergency track', () => {
    statusRequest().flush(status({ now_playing: track() }));
    safety(true);
    expect(service.warning()).toEqual({ kind: 'safety' });
    safety(false);
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
  });

  it('keeps an event that overtakes a status answer, and takes the other fact from it', () => {
    const request = statusRequest();
    safety(true);
    request.flush(status({ now_playing: track() }));
    expect(service.warning()).toEqual({ kind: 'safety' });
    safety(false);
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
  });

  it('keeps the state when the status cannot be read', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    statusRequest().flush(status({ now_playing: track() }));
    trackEnded();
    statusRequest().flush(null, { status: 500, statusText: 'Server Error' });
    expect(errors).toHaveBeenCalled();
    expect(service.warning()).toEqual({ kind: 'emergency', title: 'Reserve Song' });
  });
});

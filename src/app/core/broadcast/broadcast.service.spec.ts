import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiProblemInterceptor } from '../api/api.interceptors';
import type { ApiSchema } from '../api/api-types';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import type { RealtimeEventOf } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import { BroadcastService, UNKNOWN_BROADCAST } from './broadcast.service';

const connectedStatus = (
  time: string,
  since = '2026-10-15T08:00:00Z',
): ApiSchema<'BroadcastStatus'> => ({
  state: 'connected',
  since,
  mount_ok: true,
  last_check_at: '2026-10-15T08:00:30Z',
  time,
});

const stateEvent = (
  time: string,
  data: ApiSchema<'BroadcastStateData'>,
): RealtimeEventOf<'broadcast.state'> => ({ type: 'broadcast.state', time, data });

const reconnecting: ApiSchema<'BroadcastStateData'> = {
  state: 'reconnecting',
  since: '2026-10-15T09:00:00Z',
  mount_ok: false,
  last_check_at: '2026-10-15T09:00:05Z',
};

describe('BroadcastService', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let service: BroadcastService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T08:10:00Z'));
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        server.provider,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(BroadcastService);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function statusRequest() {
    return http.expectOne({ method: 'GET', url: '/api/broadcast/status' });
  }

  it('reads the stored state when the event connection opens', () => {
    expect(service.status()).toEqual(UNKNOWN_BROADCAST);
    statusRequest().flush(connectedStatus('2026-10-15T08:10:00Z'));
    expect(service.status()).toEqual({
      state: 'connected',
      since: '2026-10-15T08:00:00Z',
      mount_ok: true,
      last_check_at: '2026-10-15T08:00:30Z',
    });
  });

  it('reads it again after a reconnect', () => {
    statusRequest().flush(connectedStatus('2026-10-15T08:10:00Z'));
    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.open();
    statusRequest().flush({ ...connectedStatus('2026-10-15T08:10:01Z'), state: 'unreachable' });
    expect(service.status().state).toBe('unreachable');
  });

  it('follows broadcast.state', () => {
    statusRequest().flush(connectedStatus('2026-10-15T08:10:00Z'));
    server.latest.send(stateEvent('2026-10-15T09:00:05Z', reconnecting));
    expect(service.status()).toEqual(reconnecting);
  });

  it('ignores a status answer that an event has overtaken', () => {
    const request = statusRequest();
    server.latest.send(stateEvent('2026-10-15T09:00:05Z', reconnecting));
    request.flush(connectedStatus('2026-10-15T08:10:00Z'));
    expect(service.status()).toEqual(reconnecting);
  });

  it('stays unknown when the status cannot be read', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    statusRequest().flush(null, { status: 404, statusText: 'Not Found' });
    expect(service.status()).toEqual(UNKNOWN_BROADCAST);
  });

  it('keeps the server time when the browser clock is five minutes behind', () => {
    // The browser says 08:10; the server says 08:15.
    statusRequest().flush(connectedStatus('2026-10-15T08:15:00Z'));
    expect(service.clockOffsetMs()).toBe(5 * 60_000);
    expect(new Date(service.serverNow()).toISOString()).toBe('2026-10-15T08:15:00.000Z');

    // Each event resyncs the offset.
    server.latest.send(stateEvent('2026-10-15T08:10:00Z', reconnecting));
    expect(service.clockOffsetMs()).toBe(0);
  });
});

import { TestBed } from '@angular/core/testing';
import type { RealtimeEventOf } from './realtime-events';
import { parseRealtimeEvent } from './realtime-events';
import { FakeSocketServer } from './fake-socket.testing';
import { RealtimeConnection, RealtimeService } from './realtime.service';

const alert: RealtimeEventOf<'error.alert'> = {
  type: 'error.alert',
  time: '2026-10-15T08:00:00Z',
  data: { message: 'icecast connection lost', component: 'icecast' },
};

const completed: RealtimeEventOf<'retention.completed'> = {
  type: 'retention.completed',
  time: '2026-10-15T08:00:01Z',
  operation_id: 7,
  data: { kind: 'retention', summary: '12 rows removed' },
};

describe('parseRealtimeEvent', () => {
  it('reads a known event envelope', () => {
    expect(parseRealtimeEvent(JSON.stringify(alert))).toEqual(alert);
  });

  it('skips unknown types, malformed JSON, and non-text messages', () => {
    expect(parseRealtimeEvent(JSON.stringify({ ...alert, type: 'future.event' }))).toBeNull();
    expect(parseRealtimeEvent('{not json')).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ type: 'error.alert', data: {} }))).toBeNull();
    expect(parseRealtimeEvent(new ArrayBuffer(4))).toBeNull();
  });
});

describe('RealtimeService', () => {
  let server: FakeSocketServer;
  let realtime: RealtimeService;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeSocketServer();
    TestBed.configureTestingModule({ providers: [server.provider] });
    realtime = TestBed.inject(RealtimeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('connects to /api/ws on the panel origin', () => {
    realtime.connect();
    expect(server.latest.url).toBe(`ws://${location.host}/api/ws`);
    expect(realtime.state()).toBe('connecting');

    server.latest.open();
    expect(realtime.state()).toBe('connected');

    realtime.connect();
    expect(server.sockets).toHaveLength(1);
  });

  it('dispatches each event to the handlers of its type', () => {
    const alerts: unknown[] = [];
    const operations: unknown[] = [];
    realtime.on('error.alert').subscribe((event) => alerts.push(event.data.message));
    realtime.on('retention.completed').subscribe((event) => operations.push(event.operation_id));

    realtime.connect();
    server.latest.open();
    server.latest.send(alert);
    server.latest.send(completed);
    server.latest.send({ type: 'unknown.event', time: completed.time, data: {} });

    expect(alerts).toEqual(['icecast connection lost']);
    expect(operations).toEqual([7]);
  });

  it('reconnects with exponential backoff from 1 s up to 30 s', () => {
    realtime.connect();
    server.latest.open();
    server.latest.drop();
    expect(realtime.state()).toBe('reconnecting');

    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of delays) {
      const opened = server.sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(server.sockets).toHaveLength(opened);
      vi.advanceTimersByTime(1);
      expect(server.sockets).toHaveLength(opened + 1);
      server.latest.drop();
    }
  });

  it('resets the backoff after a successful connection', () => {
    realtime.connect();
    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.drop();
    vi.advanceTimersByTime(2_000);
    server.latest.open();

    server.latest.drop();
    const opened = server.sockets.length;
    vi.advanceTimersByTime(1_000);
    expect(server.sockets).toHaveLength(opened + 1);
  });

  it('reports reconnects with the time the connection went down', () => {
    const connections: RealtimeConnection[] = [];
    realtime.connected$.subscribe((connection) => connections.push(connection));

    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'));
    realtime.connect();
    server.latest.open();
    vi.setSystemTime(new Date('2026-10-15T08:05:00Z'));
    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.open();

    expect(connections).toEqual([
      { reconnect: false, downSince: null },
      { reconnect: true, downSince: new Date('2026-10-15T08:05:00Z') },
    ]);
  });

  it('stops reconnecting when disconnected', () => {
    realtime.connect();
    server.latest.open();
    const socket = server.latest;
    realtime.disconnect();

    expect(socket.closed).toBe(true);
    expect(realtime.state()).toBe('idle');
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });
});

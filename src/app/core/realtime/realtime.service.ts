import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';
import {
  RealtimeEvent,
  RealtimeEventOf,
  RealtimeEventType,
  parseRealtimeEvent,
} from './realtime-events';

export const REALTIME_PATH = '/api/ws';
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** The part of `WebSocket` the service uses, so tests can provide a fake. */
export interface RealtimeSocket {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(code?: number, reason?: string): void;
}

export const REALTIME_SOCKET_FACTORY = new InjectionToken<(url: string) => RealtimeSocket>(
  'REALTIME_SOCKET_FACTORY',
  { providedIn: 'root', factory: () => (url: string) => new WebSocket(url) },
);

/**
 * - `connecting`: the first attempt is open.
 * - `connected`: events arrive.
 * - `reconnecting`: the socket closed; a new attempt is scheduled with backoff.
 */
export type RealtimeState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface RealtimeConnection {
  /** False for the first connection of the page, true after a drop. */
  reconnect: boolean;
  /** When the previous connection closed (client clock); null for the first connection. */
  downSince: Date | null;
}

/**
 * The single event stream from the backend (design §6.5). The panel never polls for live state;
 * after a drop it reconnects with exponential backoff (1 s doubling up to 30 s), and services that
 * keep state catch up through REST when `connected$` reports a reconnect.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly createSocket = inject(REALTIME_SOCKET_FACTORY);
  private readonly location = inject(DOCUMENT).location;

  private readonly eventsSubject = new Subject<RealtimeEvent>();
  private readonly connectedSubject = new Subject<RealtimeConnection>();
  private readonly currentState = signal<RealtimeState>('idle');

  private socket: RealtimeSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failedAttempts = 0;
  private everConnected = false;
  private downSince: Date | null = null;

  readonly state = this.currentState.asReadonly();
  readonly events$: Observable<RealtimeEvent> = this.eventsSubject.asObservable();
  readonly connected$: Observable<RealtimeConnection> = this.connectedSubject.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  /** Events of one type, typed by the contract. */
  on<T extends RealtimeEventType>(type: T): Observable<RealtimeEventOf<T>> {
    return this.events$.pipe(
      filter((event) => event.type === type),
      map((event) => event as unknown as RealtimeEventOf<T>),
    );
  }

  /** Opens the connection. Calling it again while connected does nothing. */
  connect(): void {
    if (this.socket || this.retryTimer) {
      return;
    }
    this.open();
  }

  disconnect(): void {
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      detach(socket);
      socket.close();
    }
    this.currentState.set('idle');
  }

  private open(): void {
    this.retryTimer = null;
    this.currentState.set(this.everConnected ? 'reconnecting' : 'connecting');

    let socket: RealtimeSocket;
    try {
      socket = this.createSocket(this.url());
    } catch (error) {
      console.error('Could not open the event connection.', error);
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      const connection: RealtimeConnection = {
        reconnect: this.everConnected,
        downSince: this.downSince,
      };
      this.everConnected = true;
      this.failedAttempts = 0;
      this.downSince = null;
      this.currentState.set('connected');
      this.connectedSubject.next(connection);
    };
    socket.onmessage = (message) => {
      const event = parseRealtimeEvent(message.data);
      if (event) {
        this.eventsSubject.next(event);
      }
    };
    // A failed connection fires `error` and then `close`; the retry is scheduled on close only.
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      detach(socket);
      this.socket = null;
      this.downSince ??= new Date();
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    const delay = Math.min(RECONNECT_MIN_MS * 2 ** this.failedAttempts, RECONNECT_MAX_MS);
    this.failedAttempts++;
    this.currentState.set(this.everConnected ? 'reconnecting' : 'connecting');
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // Same origin as the panel: the dev proxy and nginx forward /api/ws to the backend.
  private url(): string {
    const scheme = this.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${this.location.host}${REALTIME_PATH}`;
  }
}

function detach(socket: RealtimeSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

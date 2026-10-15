import { Provider } from '@angular/core';
import type { RealtimeEvent } from './realtime-events';
import { REALTIME_SOCKET_FACTORY, RealtimeSocket } from './realtime.service';

/** A WebSocket stand-in for unit tests: no real connection is ever opened. */
export class FakeSocket implements RealtimeSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.onopen?.(new Event('open'));
  }

  send(event: RealtimeEvent | Record<string, unknown>): void {
    this.receive(JSON.stringify(event));
  }

  receive(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** The server or the network closes the connection. */
  drop(): void {
    this.onerror?.(new Event('error'));
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }

  close(): void {
    this.closed = true;
  }
}

/** Records every socket the service opens; `latest` is the current attempt. */
export class FakeSocketServer {
  readonly sockets: FakeSocket[] = [];

  get latest(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) {
      throw new Error('No socket was opened.');
    }
    return socket;
  }

  readonly provider: Provider = {
    provide: REALTIME_SOCKET_FACTORY,
    useValue: (url: string) => {
      const socket = new FakeSocket(url);
      this.sockets.push(socket);
      return socket;
    },
  };
}

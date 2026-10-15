import { Provider } from '@angular/core';
import { PREVIEW_AUDIO_FACTORY, PreviewAudio } from './player.service';

/**
 * An `HTMLAudioElement` stand-in for unit tests: nothing is fetched or decoded. Tests drive it
 * with `emit()` as a browser would fire media events.
 */
export class FakeAudio implements PreviewAudio {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  volume = 1;
  paused = true;
  error: MediaError | null = null;
  /** Media types `canPlayType()` answers with "" (cannot play). */
  unsupported = new Set<string>();
  /** Set to make the next `play()` reject. */
  playError: unknown = null;
  playCalls = 0;
  private readonly listeners = new Map<string, (() => void)[]>();

  play(): Promise<void> {
    this.playCalls++;
    if (this.playError) {
      const error = this.playError;
      this.playError = null;
      return Promise.reject(error);
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {
    this.currentTime = 0;
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }

  canPlayType(type: string): CanPlayTypeResult {
    return this.unsupported.has(type) ? '' : 'maybe';
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === 'function') {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(() => listener(new Event(type)));
      this.listeners.set(type, handlers);
    }
  }

  emit(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler();
    }
  }

  /** Fails like a source the browser could not use (a 404 or an unknown format). */
  failSource(): void {
    this.error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' } as MediaError;
    this.emit('error');
  }
}

export function provideFakeAudio(audio: FakeAudio): Provider {
  return { provide: PREVIEW_AUDIO_FACTORY, useValue: () => audio };
}

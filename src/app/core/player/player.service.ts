import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { AlertsService } from '../alerts/alerts.service';
import { ApiClient } from '../api/api-client.service';
import { ApiProblem } from '../api/api-problem';
import type { ApiSchema } from '../api/api-types';
import { problemMessage } from '../api/problem-message';
import { I18nService } from '../i18n/i18n.service';

/** The parts of `HTMLAudioElement` the player uses, so tests can pass a fake. */
export type PreviewAudio = Pick<
  HTMLAudioElement,
  | 'src'
  | 'currentTime'
  | 'duration'
  | 'volume'
  | 'paused'
  | 'error'
  | 'play'
  | 'pause'
  | 'load'
  | 'removeAttribute'
  | 'canPlayType'
  | 'addEventListener'
>;

export const PREVIEW_AUDIO_FACTORY = new InjectionToken<() => PreviewAudio>(
  'PREVIEW_AUDIO_FACTORY',
  {
    providedIn: 'root',
    factory: () => () => new Audio(),
  },
);

type Track = ApiSchema<'Track'>;

/** What the player needs to know about a track; a full `Track` fits. */
export interface PreviewTrack {
  id: number;
  title: string;
  artist?: { name: string };
  format?: Track['format'];
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Why a track cannot be played; the text is `player.errors.<reason>`. */
export type PlayerError = 'unsupported' | 'not_found' | 'failed';

// Stored formats (design §6.6) and the media types a browser is asked about.
const MEDIA_TYPES: Readonly<Record<NonNullable<Track['format']>, string>> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
};

// HTMLMediaElement error code for a source the browser could not use: the format, or a failed fetch.
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * The single track preview player (design §6.6). One audio element for the whole panel: starting a
 * track stops the previous one. Audio comes from `GET /api/tracks/{id}/audio`, which supports Range
 * requests for seeking. Playback stays in the browser; nothing about it is sent to the backend.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly alerts = inject(AlertsService);
  private readonly i18n = inject(I18nService);
  private readonly audio = inject(PREVIEW_AUDIO_FACTORY)();

  private readonly currentTrack = signal<PreviewTrack | null>(null);
  private readonly currentStatus = signal<PlayerStatus>('idle');
  private readonly currentError = signal<PlayerError | null>(null);
  private readonly currentPosition = signal(0);
  private readonly currentDuration = signal(0);
  private readonly currentVolume = signal(1);
  private probe: Subscription | null = null;

  readonly track = this.currentTrack.asReadonly();
  readonly status = this.currentStatus.asReadonly();
  readonly error = this.currentError.asReadonly();
  /** Seconds. */
  readonly position = this.currentPosition.asReadonly();
  /** Seconds; 0 until the browser knows it. */
  readonly duration = this.currentDuration.asReadonly();
  /** 0 to 1. */
  readonly volume = this.currentVolume.asReadonly();
  readonly active = computed(() => this.currentTrack() !== null);

  constructor() {
    const audio = this.audio;
    audio.volume = this.currentVolume();
    audio.addEventListener('playing', () => this.whenCurrent(() => this.setStatus('playing')));
    audio.addEventListener('pause', () =>
      this.whenCurrent(() => {
        if (this.currentStatus() === 'playing') {
          this.setStatus('paused');
        }
      }),
    );
    audio.addEventListener('waiting', () => this.whenCurrent(() => this.setStatus('loading')));
    audio.addEventListener('ended', () =>
      this.whenCurrent(() => {
        this.setStatus('paused');
        this.currentPosition.set(0);
        audio.currentTime = 0;
      }),
    );
    audio.addEventListener('timeupdate', () =>
      this.whenCurrent(() => this.currentPosition.set(audio.currentTime)),
    );
    audio.addEventListener('durationchange', () =>
      this.whenCurrent(() =>
        this.currentDuration.set(Number.isFinite(audio.duration) ? audio.duration : 0),
      ),
    );
    audio.addEventListener('error', () => this.whenCurrent(() => this.onMediaError()));
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  isCurrent(trackId: number): boolean {
    return this.currentTrack()?.id === trackId;
  }

  /** True while the track is playing or about to play. */
  isPlaying(trackId: number): boolean {
    const status = this.currentStatus();
    return this.isCurrent(trackId) && (status === 'playing' || status === 'loading');
  }

  /** Starts a track from the beginning, stopping whatever played before. */
  play(track: PreviewTrack): void {
    this.reset();
    this.currentTrack.set(track);
    const mediaType = track.format ? MEDIA_TYPES[track.format] : null;
    if (mediaType && this.audio.canPlayType(mediaType) === '') {
      this.fail('unsupported');
      return;
    }
    this.setStatus('loading');
    this.audio.src = this.api.url('/api/tracks/{id}/audio', { path: { id: track.id } });
    this.start();
  }

  /** The play button of a row: plays, pauses, or resumes that track. */
  toggle(track: PreviewTrack): void {
    if (!this.isCurrent(track.id) || this.currentStatus() === 'error') {
      this.play(track);
    } else if (this.isPlaying(track.id)) {
      this.pause();
    } else {
      this.resume();
    }
  }

  pause(): void {
    this.audio.pause();
    if (this.currentTrack() && this.currentStatus() !== 'error') {
      this.setStatus('paused');
    }
  }

  resume(): void {
    if (this.currentStatus() !== 'paused') {
      return;
    }
    this.setStatus('loading');
    this.start();
  }

  /** Stops playback and hides the player. */
  stop(): void {
    this.reset();
    this.currentTrack.set(null);
    this.setStatus('idle');
  }

  seek(seconds: number): void {
    const duration = this.currentDuration();
    if (!this.currentTrack() || duration <= 0) {
      return;
    }
    const position = Math.min(Math.max(seconds, 0), duration);
    this.audio.currentTime = position;
    this.currentPosition.set(position);
  }

  setVolume(volume: number): void {
    const value = Math.min(Math.max(volume, 0), 1);
    this.audio.volume = value;
    this.currentVolume.set(value);
  }

  private start(): void {
    const track = this.currentTrack();
    this.audio.play().catch((error: unknown) => {
      // A newer play() or pause() interrupts this one; that is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (this.currentTrack() === track) {
        this.onMediaError();
      }
    });
  }

  private reset(): void {
    this.probe?.unsubscribe();
    this.probe = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.currentError.set(null);
    this.currentPosition.set(0);
    this.currentDuration.set(0);
  }

  /**
   * The audio element does not say why a source failed. A one-byte read tells a missing file (404,
   * an error popup) from a format the browser cannot decode (a short message in the player).
   */
  private onMediaError(): void {
    const track = this.currentTrack();
    if (!track || this.currentStatus() === 'error' || this.probe) {
      return;
    }
    if (this.audio.error && this.audio.error.code !== MEDIA_ERR_SRC_NOT_SUPPORTED) {
      this.fail('failed');
      return;
    }
    const url = this.api.url('/api/tracks/{id}/audio', { path: { id: track.id } });
    // Text, so that a problem body arrives readable and becomes an ApiProblem with its code.
    this.probe = this.http
      .get(url, { headers: new HttpHeaders({ Range: 'bytes=0-0' }), responseType: 'text' })
      .subscribe({
        next: () => {
          this.probe = null;
          this.fail('unsupported');
        },
        error: (error: unknown) => {
          this.probe = null;
          if (error instanceof ApiProblem && error.status === 404) {
            this.fail('not_found');
            this.alerts.show({
              time: new Date().toISOString(),
              message: this.i18n.translate('player.errors.not_found', { title: track.title }),
              error: problemMessage(error, this.i18n),
              requestId: error.request_id,
            });
          } else {
            this.fail('failed');
          }
        },
      });
  }

  private fail(reason: PlayerError): void {
    this.audio.pause();
    this.currentError.set(reason);
    this.setStatus('error');
  }

  private setStatus(status: PlayerStatus): void {
    this.currentStatus.set(status);
  }

  // Events of a source that was replaced may still arrive; they must not change the new track.
  private whenCurrent(handler: () => void): void {
    if (this.currentTrack() && this.audio.src) {
      handler();
    }
  }
}

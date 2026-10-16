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

/**
 * The gain of the preview, for the fades at the cue points. The audio element runs through a Web
 * Audio `GainNode`; tests pass a fake.
 */
export interface PreviewFader {
  /** Sets `gain` now, then ramps linearly to each `[seconds from now, gain]` point in turn. */
  schedule(gain: number, points: readonly (readonly [number, number])[]): void;
  /** An audio context starts suspended until a user gesture; a play click is one. */
  resume(): void;
}

export const PREVIEW_FADER_FACTORY = new InjectionToken<
  (audio: PreviewAudio) => PreviewFader | null
>('PREVIEW_FADER_FACTORY', {
  providedIn: 'root',
  factory: () => (audio) => {
    if (typeof AudioContext === 'undefined' || !(audio instanceof HTMLMediaElement)) {
      return null;
    }
    // Built on the first fade: an element routed through a context stays routed, and a panel that
    // never plays a cut track never makes one.
    let graph: { context: AudioContext; gain: GainNode } | null = null;
    const ensure = () => {
      if (!graph) {
        const context = new AudioContext();
        const gain = context.createGain();
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        graph = { context, gain };
      }
      return graph;
    };
    return {
      schedule: (value, points) => {
        const { context, gain } = ensure();
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(value, now);
        for (const [seconds, target] of points) {
          gain.gain.linearRampToValueAtTime(target, now + seconds);
        }
      },
      resume: () => void ensure().context.resume(),
    };
  },
});

type Track = ApiSchema<'Track'>;

/**
 * What the player needs to know about a track; a full `Track` fits. With cue points the preview
 * plays only the part that goes on air, with its fades, as Liquidsoap would (frontend F20 §5.3).
 */
export interface PreviewTrack {
  id: number;
  title: string;
  artist?: { name: string };
  format?: Track['format'];
  cue_in_ms?: number;
  /** Absent: the end of the file. */
  cue_out_ms?: number | null;
  fade_in_ms?: number;
  fade_out_ms?: number;
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
  private readonly fader = inject(PREVIEW_FADER_FACTORY)(this.audio);
  /** Whether the gain left 1: a track without fades then resets it. */
  private faded = false;

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
    audio.addEventListener('playing', () =>
      this.whenCurrent(() => {
        this.setStatus('playing');
        this.fade(true);
      }),
    );
    audio.addEventListener('pause', () =>
      this.whenCurrent(() => {
        if (this.currentStatus() === 'playing') {
          this.setStatus('paused');
        }
        this.fade(false);
      }),
    );
    audio.addEventListener('waiting', () => this.whenCurrent(() => this.setStatus('loading')));
    audio.addEventListener('ended', () => this.whenCurrent(() => this.finish()));
    audio.addEventListener('timeupdate', () =>
      this.whenCurrent(() => {
        const out = this.cueOutSeconds();
        if (out !== null && audio.currentTime >= out) {
          // The preview ends where the air does.
          audio.pause();
          this.finish();
          return;
        }
        this.currentPosition.set(audio.currentTime);
      }),
    );
    audio.addEventListener('durationchange', () =>
      this.whenCurrent(() => {
        this.currentDuration.set(Number.isFinite(audio.duration) ? audio.duration : 0);
        // A fade out at the end of the file needs its length.
        this.fade(this.currentStatus() === 'playing');
      }),
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

  /**
   * Starts a track at its cue in (or at `fromMs` in the file), stopping whatever played before.
   */
  play(track: PreviewTrack, fromMs?: number): void {
    this.reset();
    this.currentTrack.set(track);
    const mediaType = track.format ? MEDIA_TYPES[track.format] : null;
    if (mediaType && this.audio.canPlayType(mediaType) === '') {
      this.fail('unsupported');
      return;
    }
    this.setStatus('loading');
    this.audio.src = this.api.url('/api/tracks/{id}/audio', { path: { id: track.id } });
    // Before the metadata is read this is the start position the browser seeks to.
    const start = (fromMs ?? track.cue_in_ms ?? 0) / 1000;
    this.audio.currentTime = start;
    this.currentPosition.set(start);
    this.fade(false);
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
    this.fade(this.currentStatus() === 'playing');
  }

  setVolume(volume: number): void {
    const value = Math.min(Math.max(volume, 0), 1);
    this.audio.volume = value;
    this.currentVolume.set(value);
  }

  private start(): void {
    const track = this.currentTrack();
    if (this.faded || hasFades(track)) {
      this.fader?.resume();
    }
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

  /** At the end of the file or the cue out: paused, back at the start point. */
  private finish(): void {
    const start = (this.currentTrack()?.cue_in_ms ?? 0) / 1000;
    this.setStatus('paused');
    this.currentPosition.set(start);
    this.audio.currentTime = start;
    this.fade(false);
  }

  private cueOutSeconds(): number | null {
    const out = this.currentTrack()?.cue_out_ms;
    return out === undefined || out === null ? null : out / 1000;
  }

  /**
   * Sets the gain for the position and, while playing, schedules the rest of the envelope (rise
   * after the cue in, fall to the cue out), as Liquidsoap applies `liq_fade_in` / `liq_fade_out`.
   */
  private fade(playing: boolean): void {
    const track = this.currentTrack();
    if (!this.fader || !track || (!hasFades(track) && !this.faded)) {
      return;
    }
    if (!hasFades(track)) {
      this.fader.schedule(1, []);
      this.faded = false;
      return;
    }
    const position = this.audio.currentTime * 1000;
    const envelope = fadeEnvelope(track, this.currentDuration() * 1000);
    const ahead = envelope
      .filter(([ms]) => ms > position)
      .map(([ms, gain]) => [(ms - position) / 1000, gain] as const);
    this.fader.schedule(gainAt(envelope, position), playing ? ahead : []);
    this.faded = true;
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

function hasFades(track: PreviewTrack | null): boolean {
  return !!track && ((track.fade_in_ms ?? 0) > 0 || (track.fade_out_ms ?? 0) > 0);
}

/** The gain points of the cue in ms of the file: silent at the cue points, full between the fades. */
function fadeEnvelope(track: PreviewTrack, durationMs: number): [number, number][] {
  const cueIn = track.cue_in_ms ?? 0;
  const cueOut = track.cue_out_ms ?? (durationMs > 0 ? durationMs : null);
  const fadeIn = track.fade_in_ms ?? 0;
  const fadeOut = track.fade_out_ms ?? 0;
  const points: [number, number][] = [];
  if (fadeIn > 0) {
    points.push([cueIn, 0], [cueIn + fadeIn, 1]);
  }
  if (fadeOut > 0 && cueOut !== null) {
    points.push([Math.max(cueIn, cueOut - fadeOut), 1], [cueOut, 0]);
  }
  return points;
}

/** The gain of the envelope at a position: linear between its points, 1 outside the fades. */
function gainAt(envelope: readonly [number, number][], ms: number): number {
  for (let index = 1; index < envelope.length; index++) {
    const [fromMs, from] = envelope[index - 1];
    const [toMs, to] = envelope[index];
    if (ms >= fromMs && ms <= toMs) {
      return toMs === fromMs ? to : from + ((to - from) * (ms - fromMs)) / (toMs - fromMs);
    }
  }
  return 1;
}

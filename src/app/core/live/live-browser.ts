import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';

/** The part of `navigator.mediaDevices` the live voice uses. */
export type LiveMedia = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;

/**
 * The browser's media devices, or null where the microphone cannot be used: browsers offer it only
 * in a secure context (`localhost` or HTTPS), so a panel opened on a LAN address over plain HTTP
 * gets null (backend phase-12 plan §5).
 */
export const LIVE_MEDIA = new InjectionToken<LiveMedia | null>('LIVE_MEDIA', {
  providedIn: 'root',
  factory: () => {
    const window = inject(DOCUMENT).defaultView;
    return window?.isSecureContext && window.navigator.mediaDevices
      ? window.navigator.mediaDevices
      : null;
  },
});

/** The part of `RTCPeerConnection` the live voice uses, so tests can provide a fake. */
export type LivePeer = Pick<
  RTCPeerConnection,
  | 'addTrack'
  | 'createOffer'
  | 'setLocalDescription'
  | 'setRemoteDescription'
  | 'close'
  | 'localDescription'
  | 'iceGatheringState'
  | 'addEventListener'
  | 'removeEventListener'
>;

// No STUN or TURN: the backend is on localhost or the private network (design §10), and it answers
// with its host candidates only.
export const LIVE_PEER_FACTORY = new InjectionToken<() => LivePeer>('LIVE_PEER_FACTORY', {
  providedIn: 'root',
  factory: () => () => new RTCPeerConnection({ iceServers: [] }),
});

/** The part of `AudioContext` the level meter uses. */
export type LiveAudioContext = Pick<
  AudioContext,
  'createMediaStreamSource' | 'createAnalyser' | 'close'
>;

export const LIVE_AUDIO_CONTEXT_FACTORY = new InjectionToken<() => LiveAudioContext>(
  'LIVE_AUDIO_CONTEXT_FACTORY',
  { providedIn: 'root', factory: () => () => new AudioContext() },
);

/** The meter's floor: quieter input shows as an empty meter. */
export const LEVEL_FLOOR_DB = -60;
/** A sample this close to full scale counts as clipping. */
export const CLIP_THRESHOLD = 0.99;

export interface InputLevel {
  /** 0 (at or below the floor) to 1 (full scale), on a decibel scale. */
  level: number;
  clipping: boolean;
}

/** The level of one block of samples (-1..1): RMS in decibels, mapped onto 0..1. */
export function levelOf(samples: Float32Array): InputLevel {
  let sum = 0;
  let peak = 0;
  for (const sample of samples) {
    sum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const level = Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB));
  return { level, clipping: peak >= CLIP_THRESHOLD };
}

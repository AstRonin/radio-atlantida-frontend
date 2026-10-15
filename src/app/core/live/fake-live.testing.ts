import { Provider } from '@angular/core';
import {
  LIVE_AUDIO_CONTEXT_FACTORY,
  LIVE_MEDIA,
  LIVE_PEER_FACTORY,
  LiveAudioContext,
  LiveMedia,
  LivePeer,
} from './live-browser';

/** A microphone track stand-in; `unplug()` ends it as a removed device would. */
export class FakeTrack {
  stopped = false;
  private readonly endedListeners: (() => void)[] = [];

  constructor(readonly deviceId: string) {}

  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId };
  }

  stop(): void {
    this.stopped = true;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') {
      this.endedListeners.push(listener);
    }
  }

  unplug(): void {
    for (const listener of this.endedListeners) {
      listener();
    }
  }
}

export class FakeStream {
  constructor(readonly track: FakeTrack) {}

  getAudioTracks(): FakeTrack[] {
    return [this.track];
  }

  getTracks(): FakeTrack[] {
    return [this.track];
  }
}

/** `navigator.mediaDevices` without devices: each `getUserMedia()` returns a new fake stream. */
export class FakeMedia {
  readonly streams: FakeStream[] = [];
  readonly constraints: MediaStreamConstraints[] = [];
  /** Set to make the next `getUserMedia()` reject with an error of this name. */
  failWith: string | null = null;
  devices = [
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Desk microphone' },
    { kind: 'audioinput', deviceId: 'mic-2', label: '' },
    { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers' },
  ];

  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.constraints.push(constraints);
    if (this.failWith) {
      const error = new DOMException('refused', this.failWith);
      this.failWith = null;
      return Promise.reject(error);
    }
    const audio = constraints.audio;
    const wanted =
      typeof audio === 'object' && audio.deviceId && typeof audio.deviceId === 'object'
        ? (audio.deviceId as ConstrainDOMStringParameters).exact
        : undefined;
    const stream = new FakeStream(new FakeTrack(typeof wanted === 'string' ? wanted : 'mic-1'));
    this.streams.push(stream);
    return Promise.resolve(stream as unknown as MediaStream);
  }

  enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return Promise.resolve(this.devices as unknown as MediaDeviceInfo[]);
  }
}

/** An `RTCPeerConnection` stand-in that gathers its candidates at once unless told otherwise. */
export class FakePeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = 'new';
  /** False keeps the gathering open, as when no candidate is found in time. */
  gatherAtOnce = true;
  closed = false;
  readonly tracks: FakeTrack[] = [];
  readonly replaced: FakeTrack[] = [];
  private readonly listeners: (() => void)[] = [];

  addTrack(track: FakeTrack): { replaceTrack(track: FakeTrack): Promise<void> } {
    this.tracks.push(track);
    return {
      replaceTrack: (next) => {
        this.replaced.push(next);
        return Promise.resolve();
      },
    };
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'offer', sdp: 'v=0 offer' });
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.iceGatheringState = 'gathering';
    this.localDescription = { ...description, sdp: `${description.sdp} candidates` };
    if (this.gatherAtOnce) {
      setTimeout(() => this.finishGathering());
    }
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    return Promise.resolve();
  }

  finishGathering(): void {
    this.iceGatheringState = 'complete';
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  close(): void {
    this.closed = true;
  }
}

/** An `AudioContext` whose analyser reads a constant sample value. */
export class FakeAudioContext {
  sample = 0.1;
  closed = false;

  createMediaStreamSource(): { connect(): void } {
    return { connect: () => undefined };
  }

  createAnalyser(): { fftSize: number; getFloatTimeDomainData(samples: Float32Array): void } {
    return {
      fftSize: 2048,
      getFloatTimeDomainData: (samples) => samples.fill(this.sample),
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/** The fakes and their providers; `peers` and `contexts` record every one created. */
export class FakeLiveBrowser {
  readonly media = new FakeMedia();
  readonly peers: FakePeer[] = [];
  readonly contexts: FakeAudioContext[] = [];
  /** Applied to each new peer. */
  gatherAtOnce = true;

  get peer(): FakePeer {
    const peer = this.peers.at(-1);
    if (!peer) {
      throw new Error('No peer connection was created.');
    }
    return peer;
  }

  readonly providers: Provider[] = [
    { provide: LIVE_MEDIA, useValue: this.media as unknown as LiveMedia },
    {
      provide: LIVE_PEER_FACTORY,
      useValue: () => {
        const peer = new FakePeer();
        peer.gatherAtOnce = this.gatherAtOnce;
        this.peers.push(peer);
        return peer as unknown as LivePeer;
      },
    },
    {
      provide: LIVE_AUDIO_CONTEXT_FACTORY,
      useValue: () => {
        const context = new FakeAudioContext();
        this.contexts.push(context);
        return context as unknown as LiveAudioContext;
      },
    },
  ];
}

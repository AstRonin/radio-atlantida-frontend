import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, firstValueFrom, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import { ApiProblem } from '../api/api-problem';
import type { ApiSchema } from '../api/api-types';
import { errorMessage } from '../api/problem-message';
import { I18nService } from '../i18n/i18n.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  InputLevel,
  LIVE_AUDIO_CONTEXT_FACTORY,
  LIVE_MEDIA,
  LIVE_PEER_FACTORY,
  LiveAudioContext,
  LivePeer,
  levelOf,
} from './live-browser';

export type LiveState = ApiSchema<'LiveStateData'>['state'];
export type LiveEndReason = NonNullable<ApiSchema<'LiveStateData'>['reason']>;

/** What the backend says about the live input (design §8.4, `live.state`). */
export interface LiveBackendState {
  state: LiveState;
  sessionId: number | null;
  /** UTC; when audio first reached Liquidsoap in the session. */
  onAirSince: string | null;
  /** Why the last session ended; only with `off`. */
  reason: LiveEndReason | null;
}

export type MicrophoneState = 'closed' | 'opening' | 'open';

/**
 * - `idle`: this panel sends nothing.
 * - `starting`: the offer is being prepared or sent.
 * - `active`: this panel's session is set up; the backend's state says whether audio is on air.
 */
export type SessionPhase = 'idle' | 'starting' | 'active';

export type GoLiveResult = 'started' | 'busy' | 'failed' | 'cancelled';

export interface MicrophoneInput {
  deviceId: string;
  label: string;
}

/** The backend waits at most this long for candidates; the panel sends what it has by then. */
export const ICE_GATHERING_TIMEOUT_MS = 2_000;
/** How often the meter reads the microphone. */
export const LEVEL_INTERVAL_MS = 50;

const OFF: LiveBackendState = { state: 'off', sessionId: null, onAirSince: null, reason: null };

/**
 * Live voice from the browser (design §8.4, backend phase-12 plan). The microphone stream, its
 * level meter, and the WebRTC connection live here and not in a page, so the voice continues while
 * the manager uses other pages; the shell shows it. The backend's `live.state` is the truth about
 * the air: this service only reacts when the backend ends this panel's session.
 */
@Injectable({ providedIn: 'root' })
export class LiveVoiceService {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly realtime = inject(RealtimeService);
  private readonly media = inject(LIVE_MEDIA);
  private readonly createPeer = inject(LIVE_PEER_FACTORY);
  private readonly createAudioContext = inject(LIVE_AUDIO_CONTEXT_FACTORY);

  private readonly backendState = signal<LiveBackendState>(OFF);
  private readonly bridgeAvailable = signal<boolean | null>(null);
  private readonly micState = signal<MicrophoneState>('closed');
  private readonly inputList = signal<readonly MicrophoneInput[]>([]);
  private readonly chosenInput = signal<string | null>(null);
  private readonly inputLevel = signal<InputLevel>({ level: 0, clipping: false });
  private readonly sessionPhase = signal<SessionPhase>('idle');
  private readonly ownSession = signal<number | null>(null);
  private readonly lastEnd = signal<LiveEndReason | null>(null);
  private readonly lastError = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private peer: LivePeer | null = null;
  private sender: RTCRtpSender | null = null;
  private audioContext: LiveAudioContext | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  // Each microphone change, and each start or stop, takes a new number, so a slower earlier call
  // that resumes after an await sees it was overtaken and gives up.
  private micAttempt = 0;
  private sessionAttempt = 0;

  /** False where the browser offers no microphone (not `localhost` or HTTPS). */
  readonly supported = this.media !== null;
  readonly backend = this.backendState.asReadonly();
  /** Whether the backend's bridge can take a session; null until read. */
  readonly available = this.bridgeAvailable.asReadonly();
  readonly microphone = this.micState.asReadonly();
  readonly inputs = this.inputList.asReadonly();
  readonly input = this.chosenInput.asReadonly();
  readonly level = this.inputLevel.asReadonly();
  readonly phase = this.sessionPhase.asReadonly();
  /** Why this panel's last session ended, when the backend ended it. */
  readonly endReason = this.lastEnd.asReadonly();
  /** The last failure, already translated. */
  readonly error = this.lastError.asReadonly();

  /** A session runs, from this panel or another. */
  readonly onAir = computed(() => this.backendState().state !== 'off');
  /** This panel set up the running session. */
  readonly ownsSession = computed(() => this.sessionPhase() !== 'idle');

  constructor() {
    this.realtime
      .on('live.state')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.backendState.set({
          state: data.state,
          sessionId: data.session_id ?? null,
          onAirSince: data.on_air_since ?? null,
          reason: data.reason ?? null,
        });
        if (data.state === 'off' && this.sessionPhase() === 'active') {
          // An `off` carries no session ID: confirm it is this panel's session that ended, since
          // the end of a session this panel just took over can arrive after its own start.
          this.verifyOwnSession(data.reason ?? null);
        }
      });
    this.realtime.connected$
      .pipe(
        switchMap(() => this.readStatus()),
        takeUntilDestroyed(),
      )
      .subscribe((status) => this.applyStatus(status, null));

    const window = inject(DOCUMENT).defaultView;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.sessionPhase() !== 'idle') {
        event.preventDefault();
      }
    };
    window?.addEventListener('beforeunload', beforeUnload);
    inject(DestroyRef).onDestroy(() => {
      window?.removeEventListener('beforeunload', beforeUnload);
      this.closePeer();
      this.releaseMicrophone();
    });
  }

  /**
   * Opens the microphone (or switches to another input) and starts the level meter, without
   * sending anything. While this panel is live, the new input replaces the old one on air.
   */
  async openMicrophone(deviceId: string | null = this.chosenInput()): Promise<void> {
    if (!this.media) {
      return;
    }
    const attempt = ++this.micAttempt;
    this.lastError.set(null);
    this.micState.set('opening');
    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error: unknown) {
      if (attempt === this.micAttempt) {
        this.micState.set(this.stream ? 'open' : 'closed');
        this.lastError.set(this.i18n.translate(microphoneErrorKey(error)));
      }
      return;
    }
    if (attempt !== this.micAttempt) {
      stopTracks(stream);
      return;
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stopTracks(stream);
      this.micState.set(this.stream ? 'open' : 'closed');
      this.lastError.set(this.i18n.translate('live.errors.noInput'));
      return;
    }

    const previous = this.stream;
    this.stopMeter();
    this.stream = stream;
    track.addEventListener('ended', () => this.onInputLost(stream));
    if (this.sender) {
      await this.sender.replaceTrack(track).catch(() => undefined);
    }
    if (previous) {
      stopTracks(previous);
    }
    this.chosenInput.set(track.getSettings().deviceId ?? deviceId);
    this.micState.set('open');
    this.startMeter(stream);
    // Input names are given only after the first permission, so the list is read now.
    await this.readInputs();
  }

  /** Ends this panel's session, if any, and releases the microphone. */
  closeMicrophone(): void {
    if (this.sessionPhase() !== 'idle') {
      this.stop();
    }
    this.micAttempt++;
    this.releaseMicrophone();
  }

  /**
   * Starts a session with the open microphone. `busy` means another session runs (another panel,
   * or this one before a reload): ask the manager, then call again with `takeover`.
   */
  async goOnAir(takeover = false): Promise<GoLiveResult> {
    const track = this.stream?.getAudioTracks()[0];
    if (!this.stream || !track || this.sessionPhase() !== 'idle') {
      return 'failed';
    }
    const attempt = ++this.sessionAttempt;
    const stream = this.stream;
    this.sessionPhase.set('starting');
    this.lastError.set(null);
    this.lastEnd.set(null);

    const peer = this.createPeer();
    this.peer = peer;
    this.sender = peer.addTrack(track, stream);
    try {
      await peer.setLocalDescription(await peer.createOffer());
      await gathered(peer, ICE_GATHERING_TIMEOUT_MS);
      if (attempt !== this.sessionAttempt) {
        return 'cancelled';
      }
      const offer = peer.localDescription?.sdp ?? '';
      const session = await firstValueFrom(
        this.api.post('/api/live/session', { body: { offer, takeover } }),
      );
      if (attempt !== this.sessionAttempt) {
        // Stopped while the offer was on its way: end the session it started.
        this.api.delete('/api/live/session').subscribe({ error: () => undefined });
        return 'cancelled';
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: session.answer });
      this.ownSession.set(session.session_id);
      this.sessionPhase.set('active');
      return 'started';
    } catch (error: unknown) {
      if (attempt !== this.sessionAttempt) {
        return 'cancelled';
      }
      this.closePeer();
      this.sessionPhase.set('idle');
      if (error instanceof ApiProblem && error.code === 'live_session_active') {
        return 'busy';
      }
      this.lastError.set(
        error instanceof ApiProblem
          ? errorMessage(error, this.i18n)
          : this.i18n.translate('live.errors.connection'),
      );
      return 'failed';
    }
  }

  /**
   * Ends the running session: this panel's, or one started elsewhere (the backend has one at a
   * time). The microphone stays open for the next start.
   */
  stop(): void {
    this.sessionAttempt++;
    this.closePeer();
    this.sessionPhase.set('idle');
    this.ownSession.set(null);
    this.api.delete('/api/live/session').subscribe({
      error: (error: unknown) => this.lastError.set(errorMessage(error, this.i18n)),
    });
  }

  private verifyOwnSession(reason: LiveEndReason | null): void {
    const session = this.ownSession();
    this.readStatus().subscribe((status) => this.applyStatus(status, reason, session));
  }

  private readStatus() {
    return this.api.get('/api/live/status').pipe(
      catchError((error: unknown) => {
        // The next connection or event reads again; until then the last known state stays.
        console.error('Could not read the live status.', error);
        return EMPTY;
      }),
    );
  }

  /**
   * Takes the backend's view. When this panel's session is no longer the running one, it ended on
   * the backend: the peer connection is closed and the microphone kept for a new attempt.
   */
  private applyStatus(
    status: ApiSchema<'LiveInput'>,
    reason: LiveEndReason | null,
    session: number | null = this.ownSession(),
  ): void {
    this.bridgeAvailable.set(status.available);
    const running = status.state !== 'off' ? (status.session_id ?? null) : null;
    this.backendState.update((current) => ({
      state: status.state,
      sessionId: running,
      onAirSince: status.on_air_since ?? null,
      reason: status.state === 'off' ? (reason ?? current.reason) : null,
    }));
    if (
      this.sessionPhase() === 'active' &&
      session !== null &&
      session === this.ownSession() &&
      running !== session
    ) {
      this.closePeer();
      this.sessionPhase.set('idle');
      this.ownSession.set(null);
      this.lastEnd.set(reason ?? 'dropout');
    }
  }

  private onInputLost(stream: MediaStream): void {
    if (stream !== this.stream) {
      return;
    }
    // The device was unplugged or taken by the system. The session sends silence until the
    // backend ends it for missing audio; the manager can choose another input meanwhile.
    this.stopMeter();
    this.stream = null;
    this.micState.set('closed');
    this.lastError.set(this.i18n.translate('live.errors.inputLost'));
  }

  private async readInputs(): Promise<void> {
    if (!this.media) {
      return;
    }
    try {
      const devices = await this.media.enumerateDevices();
      this.inputList.set(
        devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label:
              device.label || this.i18n.translate('live.voice.inputNumber', { number: index + 1 }),
          })),
      );
    } catch {
      // The list is a convenience; the default input still works without it.
    }
  }

  private startMeter(stream: MediaStream): void {
    try {
      const context = this.createAudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      // The analyser is not connected to the speakers, so the manager does not hear themselves.
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.audioContext = context;
      this.meterTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        this.inputLevel.set(levelOf(samples));
      }, LEVEL_INTERVAL_MS);
    } catch (error) {
      // Without a meter the voice still goes on air.
      console.error('Could not start the level meter.', error);
    }
  }

  private stopMeter(): void {
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.inputLevel.set({ level: 0, clipping: false });
  }

  private releaseMicrophone(): void {
    this.stopMeter();
    if (this.stream) {
      stopTracks(this.stream);
      this.stream = null;
    }
    this.micState.set('closed');
  }

  private closePeer(): void {
    this.peer?.close();
    this.peer = null;
    this.sender = null;
  }
}

/** Resolves when the peer has gathered its candidates, or after `timeoutMs`. */
function gathered(peer: LivePeer, timeoutMs: number): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (peer.iceGatheringState === 'complete') {
        done();
      }
    };
    const timer = setTimeout(done, timeoutMs);
    peer.addEventListener('icegatheringstatechange', check);
  });
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function microphoneErrorKey(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'live.errors.denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'live.errors.noInput';
    case 'NotReadableError':
      return 'live.errors.busy';
    default:
      return 'live.errors.microphone';
  }
}

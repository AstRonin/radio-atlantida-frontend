import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AlertsService } from '../alerts/alerts.service';
import { apiProblemInterceptor } from '../api/api.interceptors';
import { FakeAudio, provideFakeAudio } from './fake-audio.testing';
import { PlayerService, PreviewTrack } from './player.service';

const song: PreviewTrack = { id: 7, title: 'Summer', artist: { name: 'Band' }, format: 'mp3' };
const jingle: PreviewTrack = { id: 9, title: 'Station ID', format: 'ogg' };

describe('PlayerService', () => {
  let audio: FakeAudio;
  let player: PlayerService;
  let http: HttpTestingController;
  let alerts: { show: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    audio = new FakeAudio();
    alerts = { show: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideFakeAudio(audio),
        { provide: AlertsService, useValue: alerts },
      ],
    });
    player = TestBed.inject(PlayerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('streams the track from its audio endpoint, never a file path', () => {
    player.play(song);

    expect(audio.src).toBe('/api/tracks/7/audio');
    expect(audio.playCalls).toBe(1);
    expect(player.status()).toBe('loading');

    audio.emit('playing');
    expect(player.status()).toBe('playing');
    expect(player.isPlaying(7)).toBe(true);
  });

  it('stops the previous track when another starts', () => {
    player.play(song);
    audio.emit('playing');
    audio.currentTime = 42;

    player.play(jingle);

    expect(player.track()).toEqual(jingle);
    expect(audio.src).toBe('/api/tracks/9/audio');
    expect(player.position()).toBe(0);
    expect(player.isPlaying(7)).toBe(false);
  });

  it('toggles between pause and resume for the current track', () => {
    player.toggle(song);
    audio.emit('playing');

    player.toggle(song);
    expect(player.status()).toBe('paused');
    expect(audio.paused).toBe(true);

    player.toggle(song);
    expect(player.status()).toBe('loading');
    expect(audio.playCalls).toBe(2);
    audio.emit('playing');
    expect(player.status()).toBe('playing');
  });

  it('tracks position and duration, and seeks within the track', () => {
    player.play(song);
    audio.duration = 180;
    audio.emit('durationchange');
    audio.currentTime = 12.5;
    audio.emit('timeupdate');

    expect(player.duration()).toBe(180);
    expect(player.position()).toBe(12.5);

    player.seek(500);
    expect(audio.currentTime).toBe(180);
    player.seek(-3);
    expect(audio.currentTime).toBe(0);
  });

  it('sets the volume within 0 to 1', () => {
    player.setVolume(0.4);
    expect(audio.volume).toBe(0.4);
    player.setVolume(3);
    expect(player.volume()).toBe(1);
  });

  it('rewinds and pauses at the end of the track', () => {
    player.play(song);
    audio.emit('playing');
    audio.currentTime = 180;
    audio.emit('ended');

    expect(player.status()).toBe('paused');
    expect(player.position()).toBe(0);
  });

  it('refuses a format the browser cannot play without loading it', () => {
    audio.unsupported.add('audio/ogg');

    player.play(jingle);

    expect(player.status()).toBe('error');
    expect(player.error()).toBe('unsupported');
    expect(audio.playCalls).toBe(0);
  });

  it('shows an error popup when the file is missing (404)', () => {
    player.play(song);
    audio.failSource();

    const probe = http.expectOne('/api/tracks/7/audio');
    expect(probe.request.headers.get('Range')).toBe('bytes=0-0');
    probe.flush(
      JSON.stringify({
        status: 404,
        code: 'track_file_not_found',
        title: 'Not Found',
        detail: 'file music/summer.mp3 not found',
      }),
      { status: 404, statusText: 'Not Found' },
    );

    expect(player.error()).toBe('not_found');
    expect(alerts.show).toHaveBeenCalledOnce();
    expect(alerts.show.mock.calls[0][0]).toMatchObject({ message: 'player.errors.not_found' });
  });

  it('shows a short message when the file is there but cannot be decoded', () => {
    player.play(song);
    audio.failSource();

    http
      .expectOne('/api/tracks/7/audio')
      .flush('x', { status: 206, statusText: 'Partial Content' });

    expect(player.error()).toBe('unsupported');
    expect(alerts.show).not.toHaveBeenCalled();
  });

  it('plays the track again after an error', () => {
    audio.unsupported.add('audio/mpeg');
    player.play(song);
    audio.unsupported.clear();

    player.toggle(song);

    expect(player.status()).toBe('loading');
    expect(player.error()).toBeNull();
  });

  it('ignores events of a replaced source after stop', () => {
    player.play(song);
    player.stop();
    audio.emit('playing');

    expect(player.track()).toBeNull();
    expect(player.status()).toBe('idle');
  });
});

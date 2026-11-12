import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiProblem } from '../api/api-problem';
import { apiProblemInterceptor } from '../api/api.interceptors';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { DEFAULT_TIME_ZONE, StationTimeService } from '../time/station-time.service';
import { Setting, SettingSaved, SettingsSaved, SettingsService } from './settings.service';

function setting(key: string, value: unknown, apply: Setting['apply'] = 'immediate'): Setting {
  const group = key.split('.')[0] as Setting['group'];
  return {
    key,
    group,
    description: key,
    type: typeof value === 'number' ? 'integer' : 'string',
    value,
    default: value,
    is_default: true,
    nullable: false,
    apply,
    affects_air: apply === 'reconnect',
  };
}

describe('SettingsService', () => {
  let http: HttpTestingController;
  let settings: SettingsService;
  let time: StationTimeService;
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let server: FakeSocketServer;

  beforeEach(() => {
    server = new FakeSocketServer();
    snackBar = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        server.provider,
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(SettingsService);
    time = TestBed.inject(StationTimeService);
  });

  afterEach(() => http.verify());

  it('uses the defaults until the settings are loaded', () => {
    expect(settings.loaded()).toBe(false);
    expect(settings.timezone()).toBe(DEFAULT_TIME_ZONE);
    expect(settings.stationName()).toBeNull();
  });

  it('loads once and applies the station timezone', () => {
    settings.load();
    settings.load();
    http.expectOne('/api/settings').flush({
      items: [
        setting('station.timezone', 'Europe/Berlin'),
        setting('station.name', 'Radio Atlantida FM'),
        setting('liquidsoap.fade_out_ms', 2500),
      ],
    });

    expect(settings.loaded()).toBe(true);
    expect(time.zone()).toBe('Europe/Berlin');
    expect(settings.stationName()).toBe('Radio Atlantida FM');
    expect(settings.get('liquidsoap.fade_out_ms')?.value).toBe(2500);

    settings.load();
    http.expectNone('/api/settings');
  });

  it('keeps a valid zone when the setting names one the browser does not know', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settings.load();
    http.expectOne('/api/settings').flush({ items: [setting('station.timezone', 'Mars/Olympus')] });
    expect(time.zone()).toBe(DEFAULT_TIME_ZONE);
  });

  it('loads again when the event connection opens after a failed load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settings.load();
    http.expectOne('/api/settings').flush(null, { status: 502, statusText: 'Bad Gateway' });
    expect(settings.loaded()).toBe(false);

    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    http.expectOne('/api/settings').flush({ items: [] });
    expect(settings.loaded()).toBe(true);
  });

  it('shows a notice when a saved setting applies on reconnect', () => {
    let saved: SettingSaved | undefined;
    settings.save('stream.icecast_host', 'icecast.example').subscribe((result) => (saved = result));

    const req = http.expectOne('/api/settings/stream.icecast_host');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ value: 'icecast.example' });
    req.flush(setting('stream.icecast_host', 'icecast.example', 'reconnect'));

    expect(saved?.needsReconnect).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith(
      'settings.reconnectNotice',
      'common.close',
      expect.anything(),
    );
    expect(settings.get('stream.icecast_host')?.value).toBe('icecast.example');
  });

  it('saves an immediate setting without a notice and applies a new timezone', () => {
    settings.save('station.timezone', 'UTC').subscribe();
    http.expectOne('/api/settings/station.timezone').flush(setting('station.timezone', 'UTC'));

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(time.zone()).toBe('UTC');
  });

  it('passes a refused value on as a problem with the field error', () => {
    let problem: unknown;
    settings
      .save('liquidsoap.fade_out_ms', 5000)
      .subscribe({ error: (error: unknown) => (problem = error) });
    http.expectOne('/api/settings/liquidsoap.fade_out_ms').flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Validation failed',
        errors: [{ field: 'value', code: 'range', message: 'must be 2000 to 3000' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    expect(problem).toBeInstanceOf(ApiProblem);
    expect((problem as ApiProblem).errors.map((error) => error.field)).toEqual(['value']);
    expect(settings.get('liquidsoap.fade_out_ms')).toBeUndefined();
  });
  describe('saveMany', () => {
    function loadSettings(): void {
      settings.load();
      http.expectOne('/api/settings').flush({
        items: [
          setting('station.timezone', 'Europe/Berlin'),
          setting('stream.bitrate_kbps', 128, 'reconnect'),
          setting('stream.sample_rate_hz', 44100, 'reconnect'),
        ],
      });
    }

    it('saves all values in one request and shows one notice for several reconnect settings', () => {
      loadSettings();
      let saved: SettingsSaved | undefined;
      settings
        .saveMany({ 'stream.bitrate_kbps': 64, 'stream.sample_rate_hz': 22050 })
        .subscribe((result) => (saved = result));

      const req = http.expectOne('/api/settings');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({
        values: { 'stream.bitrate_kbps': 64, 'stream.sample_rate_hz': 22050 },
      });
      req.flush({
        items: [
          setting('stream.bitrate_kbps', 64, 'reconnect'),
          setting('stream.sample_rate_hz', 22050, 'reconnect'),
        ],
      });

      expect(saved?.needsReconnect).toBe(true);
      expect(saved?.settings.map((item) => item.key)).toEqual([
        'stream.bitrate_kbps',
        'stream.sample_rate_hz',
      ]);
      expect(snackBar.open).toHaveBeenCalledTimes(1);
      expect(snackBar.open).toHaveBeenCalledWith(
        'settings.reconnectNotice',
        'common.close',
        expect.anything(),
      );
      expect(settings.get('stream.bitrate_kbps')?.value).toBe(64);
      expect(settings.get('stream.sample_rate_hz')?.value).toBe(22050);
      // Settings outside the batch stay, in the backend's order.
      expect(settings.settings().map((item) => item.key)).toEqual([
        'station.timezone',
        'stream.bitrate_kbps',
        'stream.sample_rate_hz',
      ]);
    });

    it('shows no notice without a reconnect setting and applies a new timezone', () => {
      loadSettings();
      settings.saveMany({ 'station.timezone': 'UTC' }).subscribe();
      http
        .expectOne({ method: 'PATCH', url: '/api/settings' })
        .flush({ items: [setting('station.timezone', 'UTC')] });

      expect(snackBar.open).not.toHaveBeenCalled();
      expect(time.zone()).toBe('UTC');
    });

    it('changes nothing when the batch is refused', () => {
      loadSettings();
      let problem: unknown;
      settings
        .saveMany({ 'stream.bitrate_kbps': 320, 'station.timezone': 'UTC' })
        .subscribe({ error: (error: unknown) => (problem = error) });
      http.expectOne({ method: 'PATCH', url: '/api/settings' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Validation failed',
          errors: [
            {
              field: 'values.stream.bitrate_kbps',
              code: 'encoder_limit',
              message: 'Vorbis mono at 22050 Hz allows at most 64 kbps; the bitrate is 320 kbps.',
            },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      expect(problem).toBeInstanceOf(ApiProblem);
      expect((problem as ApiProblem).errors.map((error) => error.field)).toEqual([
        'values.stream.bitrate_kbps',
      ]);
      expect(settings.get('stream.bitrate_kbps')?.value).toBe(128);
      expect(settings.get('station.timezone')?.value).toBe('Europe/Berlin');
      expect(time.zone()).toBe('Europe/Berlin');
      expect(snackBar.open).not.toHaveBeenCalled();
    });
  });
});

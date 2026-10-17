import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { Setting } from '../../core/settings/settings.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import { SecretStatus, isChanged, settingControl, settingKind } from './settings-form';
import SettingsPageComponent from './settings-page.component';

function setting(key: string, overrides: Partial<Setting> = {}): Setting {
  return {
    key,
    group: key.split('.')[0] as Setting['group'],
    description: key,
    type: 'integer',
    value: 1,
    default: 1,
    is_default: true,
    nullable: false,
    apply: 'immediate',
    affects_air: false,
    ...overrides,
  };
}

const fadeOut = setting('liquidsoap.fade_out_ms', {
  value: 2500,
  default: 2500,
  minimum: 2000,
  maximum: 3000,
  unit: 'ms',
  affects_air: true,
});
const icecastHost = setting('stream.icecast_host', {
  type: 'string',
  value: 'icecast',
  default: 'icecast',
  minimum: 1,
  maximum: 253,
  apply: 'reconnect',
  affects_air: true,
});
const stationName = setting('station.name', {
  type: 'string',
  value: 'Radio Atlantida FM',
  default: 'Radio Atlantida',
  is_default: false,
  minimum: 1,
  maximum: 100,
});
const playedCount = setting('air.played_count', {
  value: 10,
  default: 10,
  minimum: 1,
  maximum: 50,
});
const queuedCount = setting('air.queued_count', {
  value: 9,
  default: 9,
  minimum: 0,
  maximum: 50,
});
const minGap = setting('rotation.min_gap_ms', {
  value: 10000,
  default: 10000,
  minimum: 0,
  maximum: 60000,
  unit: 'ms',
});

const SECRETS: SecretStatus[] = [
  {
    name: 'ICECAST_SOURCE_PASSWORD',
    group: 'stream',
    description: 'Icecast source password.',
    is_set: true,
  },
  {
    name: 'LIQUIDSOAP_CONTROL_PASSWORD',
    group: 'liquidsoap',
    description: 'Liquidsoap control password.',
    is_set: false,
  },
];

describe('settings', () => {
  describe('settings form', () => {
    it('picks the input from the definition', () => {
      expect(settingKind(fadeOut)).toBe('number');
      expect(settingKind(icecastHost)).toBe('text');
      expect(settingKind(setting('stream.codec', { type: 'string', enum: ['mp3', 'aac'] }))).toBe(
        'select',
      );
      expect(settingKind(setting('stream.hls_enabled', { type: 'boolean' }))).toBe('boolean');
      expect(settingKind(setting('station.timezone', { type: 'string' }))).toBe('timezone');
      expect(
        settingKind(setting('playout.emergency_playlist_id', { nullable: true, value: null })),
      ).toBe('playlist');
    });

    it('mirrors the range and the length limits of the backend', () => {
      const fade = settingControl(fadeOut);
      fade.setValue(1500);
      expect(fade.hasError('range')).toBe(true);
      fade.setValue(2500.5);
      expect(fade.hasError('step')).toBe(true);
      fade.setValue(null);
      expect(fade.hasError('required')).toBe(true);
      fade.setValue(3000);
      expect(fade.valid).toBe(true);

      const host = settingControl(icecastHost);
      host.setValue('');
      expect(host.hasError('required')).toBe(true);
      host.setValue('x'.repeat(254));
      expect(host.hasError('maxlength')).toBe(true);

      const description = settingControl(
        setting('stream.description', { type: 'string', value: '', minimum: 0, maximum: 500 }),
      );
      expect(description.valid).toBe(true);
    });

    it('limits the rows of the air window like the backend', () => {
      const played = settingControl(playedCount);
      for (const value of [1, 50]) {
        played.setValue(value);
        expect(played.valid).toBe(true);
      }
      for (const value of [0, 51]) {
        played.setValue(value);
        expect(played.hasError('range')).toBe(true);
      }

      const queued = settingControl(queuedCount);
      for (const value of [0, 50]) {
        queued.setValue(value);
        expect(queued.valid).toBe(true);
      }
      for (const value of [-1, 51]) {
        queued.setValue(value);
        expect(queued.hasError('range')).toBe(true);
      }
      queued.setValue(2.5);
      expect(queued.hasError('step')).toBe(true);
    });

    it('allows no emergency playlist, since the setting is nullable', () => {
      const control = settingControl(
        setting('playout.emergency_playlist_id', { nullable: true, value: null, minimum: 1 }),
      );
      expect(control.valid).toBe(true);
    });

    it('compares the value with the saved one', () => {
      const name = settingControl(stationName) as FormControl<string | null>;
      expect(isChanged(stationName, name)).toBe(false);
      name.setValue('Atlantida');
      expect(isChanged(stationName, name)).toBe(true);
    });
  });

  describe('SettingsPageComponent', () => {
    let http: HttpTestingController;
    let fixture: ComponentFixture<SettingsPageComponent>;
    let overlay: HTMLElement;
    let snackBar: { open: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      snackBar = { open: vi.fn() };
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([apiProblemInterceptor])),
          provideHttpClientTesting(),
          provideRouter([]),
          new FakeSocketServer().provider,
          { provide: MatSnackBar, useValue: snackBar },
          { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      overlay = TestBed.inject(OverlayContainer).getContainerElement();
      fixture = TestBed.createComponent(SettingsPageComponent);
      await settlePage();
      http
        .expectOne('/api/settings')
        .flush({ items: [stationName, icecastHost, fadeOut, minGap, playedCount, queuedCount] });
      http.expectOne('/api/settings/secrets').flush({ items: SECRETS });
      await settlePage();
    });

    afterEach(() => {
      TestBed.inject(MatDialog).closeAll();
      flushHelp(http);
      http.verify();
    });

    const page = () => fixture.nativeElement as HTMLElement;
    const section = (group: string) =>
      page().querySelector<HTMLElement>(`section[aria-labelledby="group-${group}"]`);
    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
        item.textContent?.includes(label),
      );
    const input = (group: string) => section(group)?.querySelector<HTMLInputElement>('input');
    const type = (element: HTMLInputElement | null | undefined, value: string) => {
      if (!element) {
        throw new Error('No input.');
      }
      element.value = value;
      element.dispatchEvent(new Event('input'));
    };

    it('shows the sections in the order of the plan', () => {
      const titles = [...page().querySelectorAll('h2.group-title')].map((title) =>
        title.textContent?.trim(),
      );
      expect(titles).toEqual([
        'settings.groups.station',
        'settings.groups.stream',
        'settings.groups.liquidsoap',
        'settings.groups.rotation',
        'settings.groups.air',
      ]);
    });

    it('shows the default, whether it is in use, and when a change applies', () => {
      const station = section('station')?.textContent ?? '';
      expect(station).toContain('settings.meta.default');
      expect(station).not.toContain('settings.meta.isDefault');
      expect(station).toContain('settings.apply.immediate');

      const stream = section('stream')?.textContent ?? '';
      expect(stream).toContain('settings.meta.isDefault');
      expect(stream).toContain('settings.apply.reconnect');
      expect(stream).toContain('settings.meta.affectsAir');
    });

    it('lists secrets only as set or not set, without any value or input', () => {
      const stream = section('stream');
      const liquidsoap = section('liquidsoap');
      expect(stream?.querySelector('.secrets')?.textContent).toContain('ICECAST_SOURCE_PASSWORD');
      expect(stream?.querySelector('.secrets')?.textContent).toContain('settings.secrets.set');
      expect(liquidsoap?.querySelector('.secrets')?.textContent).toContain(
        'settings.secrets.notSet',
      );
      expect(page().querySelectorAll('.secrets input, .secrets textarea')).toHaveLength(0);
      expect(page().querySelector('input[type="password"]')).toBeNull();
    });

    it('asks before saving a value that needs a reconnect, then saves it', async () => {
      type(input('stream'), 'icecast2.local');
      await settlePage();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);

      button(page(), 'common.save')?.click();
      await settlePage();
      expect(overlay.textContent).toContain('settings.reconnect.title');
      http.expectNone('/api/settings/stream.icecast_host');

      button(overlay, 'common.save')?.click();
      await settlePage();
      const put = http.expectOne({ method: 'PUT', url: '/api/settings/stream.icecast_host' });
      expect(put.request.body).toEqual({ value: 'icecast2.local' });
      put.flush({ ...icecastHost, value: 'icecast2.local', is_default: false });
      await settlePage();

      expect(snackBar.open).toHaveBeenCalledWith(
        'settings.reconnectNotice',
        'common.close',
        expect.anything(),
      );
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      expect(section('stream')?.textContent).toContain('settings.meta.default');
    });

    it('does not save when the reconnect notice is cancelled', async () => {
      type(input('stream'), 'icecast2.local');
      await settlePage();
      button(page(), 'common.save')?.click();
      await settlePage();
      button(overlay, 'common.cancel')?.click();
      await settlePage();

      http.expectNone('/api/settings/stream.icecast_host');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('saves an immediate value without asking and shows a refusal next to the field', async () => {
      type(input('liquidsoap'), '2600');
      await settlePage();
      button(page(), 'common.save')?.click();
      await settlePage();
      expect(overlay.textContent).not.toContain('settings.reconnect.title');

      http.expectOne({ method: 'PUT', url: '/api/settings/liquidsoap.fade_out_ms' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Validation failed',
          errors: [{ field: 'value', code: 'range', message: 'must be between 2000 and 3000' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();

      expect(section('liquidsoap')?.textContent).toContain('must be between 2000 and 3000');
      // Without loaded translations the label falls back to the key, the message to the title.
      expect(page().querySelector('.save-bar [role="alert"]')?.textContent).toContain(
        'liquidsoap.fade_out_ms: Validation failed',
      );
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('saves the rows of the air window', async () => {
      const [played, queued] = [
        ...(section('air')?.querySelectorAll<HTMLInputElement>('input') ?? []),
      ];
      type(played, '20');
      type(queued, '0');
      await settlePage();
      button(page(), 'common.save')?.click();
      await settlePage();

      const playedPut = http.expectOne({ method: 'PUT', url: '/api/settings/air.played_count' });
      expect(playedPut.request.body).toEqual({ value: 20 });
      playedPut.flush({ ...playedCount, value: 20, is_default: false });
      await settlePage();
      const queuedPut = http.expectOne({ method: 'PUT', url: '/api/settings/air.queued_count' });
      expect(queuedPut.request.body).toEqual({ value: 0 });
      queuedPut.flush({ ...queuedCount, value: 0, is_default: false });
      await settlePage();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('keeps Save disabled while a value is invalid', async () => {
      type(input('liquidsoap'), '1500');
      await settlePage();
      expect(button(page(), 'common.save')?.disabled).toBe(true);
    });

    it('discards changes back to the saved values', async () => {
      type(input('station'), 'Other name');
      await settlePage();
      button(page(), 'settings.discard')?.click();
      await settlePage();
      expect(input('station')?.value).toBe('Radio Atlantida FM');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });
  });
});

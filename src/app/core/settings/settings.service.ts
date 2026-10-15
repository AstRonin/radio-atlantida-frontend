import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, filter, map, tap } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import type { ApiSchema } from '../api/api-types';
import { I18nService } from '../i18n/i18n.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DEFAULT_TIME_ZONE, StationTimeService } from '../time/station-time.service';

export type Setting = ApiSchema<'Setting'>;

/** Keys the panel itself reads. Every other setting is shown and edited generically (Phase F5). */
export const SETTING_KEYS = {
  stationTimezone: 'station.timezone',
  stationName: 'station.name',
} as const;

export const RECONNECT_NOTICE_MS = 10_000;

export interface SettingSaved {
  setting: Setting;
  /** The new value takes effect when its connection is opened again (design §6.3). */
  needsReconnect: boolean;
}

/**
 * Station settings (design §6.3), loaded once from `GET /api/settings`. Until they arrive, the
 * panel uses the code defaults, so the station timezone is `Asia/Yerevan` from the first render.
 * A load that fails is repeated when the event connection opens, which is when the backend is back.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiClient);
  private readonly time = inject(StationTimeService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly byKey = signal<ReadonlyMap<string, Setting>>(new Map());
  private readonly loadedState = signal(false);
  private loading = false;

  readonly loaded = this.loadedState.asReadonly();
  /** All settings in the backend's order. */
  readonly settings = computed(() => [...this.byKey().values()]);
  readonly timezone = computed(
    () => this.stringValue(SETTING_KEYS.stationTimezone) ?? DEFAULT_TIME_ZONE,
  );
  /** Null while unset; the header then shows the translated placeholder. */
  readonly stationName = computed(() => this.stringValue(SETTING_KEYS.stationName) || null);

  constructor() {
    inject(RealtimeService)
      .connected$.pipe(
        filter(() => !this.loadedState()),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.load());
  }

  /** Loads the settings unless they are loaded or loading. */
  load(): void {
    if (this.loading || this.loadedState()) {
      return;
    }
    this.loading = true;
    this.api
      .get('/api/settings')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.loading = false;
          this.byKey.set(new Map(list.items.map((setting) => [setting.key, setting])));
          this.loadedState.set(true);
          this.applyTimezone();
        },
        error: (error: unknown) => {
          this.loading = false;
          console.error('Could not load the settings; the defaults stay in use.', error);
        },
      });
  }

  get(key: string): Setting | undefined {
    return this.byKey().get(key);
  }

  /**
   * Saves one value. A refused value fails with an `ApiProblem` whose field error is on `value`.
   * When the setting applies on reconnect, a notice says so.
   */
  save(key: string, value: unknown): Observable<SettingSaved> {
    return this.api.put('/api/settings/{key}', { path: { key }, body: { value } }).pipe(
      tap((setting) => {
        this.byKey.update((settings) => new Map(settings).set(setting.key, setting));
        if (setting.key === SETTING_KEYS.stationTimezone) {
          this.applyTimezone();
        }
      }),
      map((setting) => ({ setting, needsReconnect: setting.apply === 'reconnect' })),
      tap(({ needsReconnect }) => {
        if (needsReconnect) {
          this.snackBar.open(
            this.i18n.translate('settings.reconnectNotice'),
            this.i18n.translate('common.close'),
            { duration: RECONNECT_NOTICE_MS },
          );
        }
      }),
    );
  }

  private stringValue(key: string): string | undefined {
    const value = this.byKey().get(key)?.value;
    return typeof value === 'string' ? value : undefined;
  }

  private applyTimezone(): void {
    const zone = this.timezone();
    if (!this.time.setZone(zone)) {
      console.error(`The station timezone "${zone}" is not known to this browser.`);
    }
  }
}

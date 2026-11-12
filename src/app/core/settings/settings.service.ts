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

/** Keys the panel itself reads. Every other setting is shown and edited generically. */
export const SETTING_KEYS = {
  stationTimezone: 'station.timezone',
  stationName: 'station.name',
  emergencyPlaylistId: 'playout.emergency_playlist_id',
} as const;

export const RECONNECT_NOTICE_MS = 10_000;

export interface SettingSaved {
  setting: Setting;
  /** The new value takes effect when its connection is opened again (design §6.3). */
  needsReconnect: boolean;
}

export interface SettingsSaved {
  /** The saved settings, in the backend's order; only the keys of the batch. */
  settings: Setting[];
  /** At least one of them takes effect when its connection is opened again (design §6.3). */
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
    this.refresh()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => (this.loading = false),
        error: (error: unknown) => {
          this.loading = false;
          console.error('Could not load the settings; the defaults stay in use.', error);
        },
      });
  }

  /**
   * Reads the settings again, for the settings page, which shows their current state. Fails with
   * an `ApiProblem`; the settings known before stay in use.
   */
  refresh(): Observable<Setting[]> {
    return this.api.get('/api/settings').pipe(
      map((list) => list.items),
      tap((items) => {
        this.byKey.set(new Map(items.map((setting) => [setting.key, setting])));
        this.loadedState.set(true);
        this.applyTimezone();
      }),
    );
  }

  /**
   * Reads the current emergency playlist, null when none is set. It is read again each time, so a
   * change made in Settings shows on the playlist pages. Fails with an `ApiProblem`.
   */
  emergencyPlaylistId(): Observable<number | null> {
    return this.refresh().pipe(
      map(() => {
        const value = this.get(SETTING_KEYS.emergencyPlaylistId)?.value;
        return typeof value === 'number' ? value : null;
      }),
    );
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
      map((setting) => {
        const needsReconnect = this.store([setting]);
        return { setting, needsReconnect };
      }),
    );
  }

  /**
   * Saves several values in one batch, all or nothing (`PATCH /api/settings`), so the backend
   * checks the cross-key rules such as the encoder limits against the whole batch. A refusal
   * fails with an `ApiProblem` whose field errors are on `values.<key>`, and nothing changes.
   * One notice covers every setting of the batch that applies on reconnect.
   */
  saveMany(values: Readonly<Record<string, unknown>>): Observable<SettingsSaved> {
    return this.api.patch('/api/settings', { body: { values: { ...values } } }).pipe(
      map(({ items }) => {
        const needsReconnect = this.store(items);
        return { settings: items, needsReconnect };
      }),
    );
  }

  /** Keeps saved settings, applies a new timezone, and announces a reconnect once. */
  private store(saved: readonly Setting[]): boolean {
    this.byKey.update((settings) => {
      const next = new Map(settings);
      for (const setting of saved) {
        next.set(setting.key, setting);
      }
      return next;
    });
    if (saved.some((setting) => setting.key === SETTING_KEYS.stationTimezone)) {
      this.applyTimezone();
    }
    const needsReconnect = saved.some((setting) => setting.apply === 'reconnect');
    if (needsReconnect) {
      this.snackBar.open(
        this.i18n.translate('settings.reconnectNotice'),
        this.i18n.translate('common.close'),
        { duration: RECONNECT_NOTICE_MS },
      );
    }
    return needsReconnect;
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

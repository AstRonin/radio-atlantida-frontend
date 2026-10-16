import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subject, catchError, interval, map, merge, of, startWith, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { LiveVoiceComponent } from './live-voice.component';
import { MusicGainComponent } from './music-gain.component';
import { OnAirComponent, QueuedRow } from './on-air.component';

type PlayoutStatus = ApiSchema<'PlayoutStatus'>;

/** Progress of the current track is redrawn this often; the backend sends no progress events. */
export const PROGRESS_TICK_MS = 1_000;

/**
 * The on-air console (design §8.4, §8.5): live voice from the browser, the music gain, and what
 * plays now. The playout status is read when the page opens and when the event connection opens;
 * after that, `playout.now_playing`, `liquidsoap.state`, and `icecast.state` keep it current, and a
 * new track reads the queue again, because the backend pushes the next items after each start.
 */
@Component({
  selector: 'app-live-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe,
    LiveVoiceComponent,
    MusicGainComponent,
    OnAirComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="live.title" helpPage="help.live" />

    <section class="page-section" aria-labelledby="voice-heading">
      <h2 id="voice-heading" class="section-title">{{ 'live.voice.title' | translate }}</h2>
      <app-live-voice />
    </section>

    <section class="page-section" aria-labelledby="gain-heading">
      <h2 id="gain-heading" class="section-title">{{ 'live.gain.title' | translate }}</h2>
      <p class="muted">{{ 'live.gain.note' | translate }}</p>
      <app-music-gain [gain]="status()?.music_gain ?? null" />
    </section>

    <section class="page-section" aria-labelledby="air-heading">
      <h2 id="air-heading" class="section-title">{{ 'live.onAir.title' | translate }}</h2>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      @if (status(); as current) {
        <app-on-air [status]="current" [queued]="queued()" [now]="now()" />
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }
  `,
})
export default class LivePageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly realtime = inject(RealtimeService);

  private readonly loads = new Subject<void>();

  protected readonly status = signal<PlayoutStatus | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly now = signal(Date.now());

  protected readonly queued = computed((): QueuedRow[] =>
    (this.status()?.queued ?? []).map((item) => ({
      item,
      preview: {
        id: item.track_id,
        title: item.title,
        artist: item.artist_name ? { name: item.artist_name } : undefined,
      },
    })),
  );

  constructor() {
    merge(this.loads, this.realtime.connected$)
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading.set(true);
          return this.api.get('/api/playout/status').pipe(
            map((status) => ({ status, error: null })),
            catchError((error: unknown) => of({ status: null, error })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ status, error }) => {
        this.loading.set(false);
        if (status) {
          this.status.set(status);
          this.loadError.set(null);
        } else {
          this.loadError.set(errorMessage(error, this.i18n));
        }
      });

    this.realtime
      .on('playout.now_playing')
      .pipe(takeUntilDestroyed())
      .subscribe(({ data }) => {
        this.patch((status) => ({ ...status, now_playing: data }));
        this.reload();
      });
    this.realtime
      .on('liquidsoap.state')
      .pipe(takeUntilDestroyed())
      .subscribe(({ time, data }) =>
        this.patch((status) => ({
          ...status,
          control_link: { ...status.control_link, connected: data.connected, since: time },
        })),
      );
    this.realtime
      .on('icecast.state')
      .pipe(takeUntilDestroyed())
      .subscribe(({ time, data }) =>
        this.patch((status) => ({ ...status, output: { state: data.state, since: time } })),
      );

    interval(PROGRESS_TICK_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));
  }

  protected reload(): void {
    this.loads.next();
  }

  private patch(change: (status: PlayoutStatus) => PlayoutStatus): void {
    this.status.update((status) => (status ? change(status) : status));
  }
}

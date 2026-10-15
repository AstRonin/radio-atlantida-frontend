import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';
import { TranslatePipe } from '../i18n/translate.pipe';
import { formatSeconds } from '../time/duration';
import { PlayerService } from './player.service';

/**
 * The preview player, mounted once at the bottom of the shell so playback survives navigation
 * (design §6.6). Hidden until a track is started.
 */
@Component({
  selector: 'app-player-bar',
  imports: [MatButtonModule, MatSliderModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (player.track(); as track) {
      <section class="bar" [attr.aria-label]="'player.region' | translate">
        <button
          matIconButton
          type="button"
          class="toggle"
          [disabled]="player.status() === 'error'"
          [attr.aria-label]="
            (player.isPlaying(track.id) ? 'player.pause' : 'player.play')
              | translate: { title: track.title }
          "
          (click)="player.toggle(track)"
        >
          <span aria-hidden="true">{{ player.isPlaying(track.id) ? '❚❚' : '▶' }}</span>
        </button>

        <div class="info">
          <span class="title">{{ track.title }}</span>
          @if (track.artist) {
            <span class="artist">{{ track.artist.name }}</span>
          }
        </div>

        @if (player.error(); as error) {
          <p class="error" role="alert">
            {{ 'player.errors.' + error | translate: { title: track.title } }}
          </p>
        } @else {
          <div class="progress">
            <span class="time">{{ time(player.position()) }}</span>
            <mat-slider
              class="seek"
              min="0"
              [max]="player.duration() || 1"
              step="0.1"
              [disabled]="player.duration() === 0"
            >
              <input
                matSliderThumb
                [value]="player.position()"
                [attr.aria-label]="'player.seek' | translate"
                [attr.aria-valuetext]="time(player.position()) + ' / ' + time(player.duration())"
                (valueChange)="player.seek($event)"
              />
            </mat-slider>
            <span class="time">{{ time(player.duration()) }}</span>
          </div>
        }

        <mat-slider class="volume" min="0" max="1" step="0.05">
          <input
            matSliderThumb
            [value]="player.volume()"
            [attr.aria-label]="'player.volume' | translate"
            [attr.aria-valuetext]="percent(player.volume())"
            (valueChange)="player.setVolume($event)"
          />
        </mat-slider>

        <button matButton type="button" (click)="player.stop()">
          {{ 'player.close' | translate }}
        </button>
      </section>
    }
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: center;
      padding: 0.25rem 1rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
    }

    .info {
      display: flex;
      flex-direction: column;
      min-width: 10rem;
      max-width: 20rem;
    }

    .title,
    .artist {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      font: var(--mat-sys-title-small);
    }

    .artist,
    .time {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .time {
      font-variant-numeric: tabular-nums;
    }

    .progress {
      display: flex;
      flex: 1 1 16rem;
      gap: 0.5rem;
      align-items: center;
    }

    .seek {
      flex: 1 1 auto;
    }

    .volume {
      width: 6rem;
    }

    .error {
      flex: 1 1 16rem;
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class PlayerBarComponent {
  protected readonly player = inject(PlayerService);

  protected time(seconds: number): string {
    return formatSeconds(seconds);
  }

  protected percent(volume: number): string {
    return `${Math.round(volume * 100)}%`;
  }
}

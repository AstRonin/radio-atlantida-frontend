import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../core/i18n/i18n.service';
import { PlayerService, PreviewTrack } from '../../core/player/player.service';

/**
 * The play button next to a track (design §6.6). It plays the track in the shared preview player,
 * or pauses it while it plays. The preview never goes to air.
 */
@Component({
  selector: 'app-play-button',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      matIconButton
      type="button"
      class="play"
      [class.current]="current()"
      [attr.aria-label]="label()"
      [attr.aria-pressed]="playing()"
      (click)="toggle($event)"
    >
      <span aria-hidden="true">{{ playing() ? '❚❚' : '▶' }}</span>
    </button>
  `,
  styles: `
    .play {
      font-size: 0.875rem;
    }

    .current {
      color: var(--mat-sys-primary);
    }
  `,
})
export class PlayButtonComponent {
  private readonly player = inject(PlayerService);
  private readonly i18n = inject(I18nService);

  readonly track = input.required<PreviewTrack>();

  protected readonly current = computed(() => this.player.track()?.id === this.track().id);
  protected readonly playing = computed(() => this.player.isPlaying(this.track().id));
  protected readonly label = computed(() =>
    this.i18n.translate(this.playing() ? 'player.pause' : 'player.play', {
      title: this.track().title,
    }),
  );

  protected toggle(event: Event): void {
    // Rows are often selectable; playing a track must not select it too.
    event.stopPropagation();
    this.player.toggle(this.track());
  }
}

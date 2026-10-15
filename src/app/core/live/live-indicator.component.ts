import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../i18n/translate.pipe';
import { LiveVoiceService } from './live-voice.service';

/**
 * The header's live mark: while a live session runs, it says so on every page, links to the Live
 * page, and lets this panel stop its own session without going there.
 */
@Component({
  selector: 'app-live-indicator',
  imports: [MatButtonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (live.onAir() || live.ownsSession()) {
      <span class="indicator" role="status">
        <a class="mark" routerLink="/live" [class.on-air]="state() === 'on_air'">
          {{ 'live.states.' + state() | translate }}
        </a>
        @if (live.ownsSession()) {
          <button matButton type="button" (click)="live.stop()">
            {{ 'live.voice.stop' | translate }}
          </button>
        }
      </span>
    }
  `,
  styles: `
    .indicator {
      display: inline-flex;
      gap: 0.25rem;
      align-items: center;
    }

    .mark {
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-large);
      text-decoration: none;
    }

    .mark.on-air {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
  `,
})
export class LiveIndicatorComponent {
  protected readonly live = inject(LiveVoiceService);

  // While this panel sets up its session, the backend still reports `off`.
  protected readonly state = computed(() => {
    const state = this.live.backend().state;
    return state === 'off' && this.live.ownsSession() ? 'connecting' : state;
  });
}

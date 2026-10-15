import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** The presets of design §8.5: normal, background under voice, music off. */
export const GAIN_PRESETS = [
  { key: 'normal', gain: 1 },
  { key: 'underVoice', gain: 0.2 },
  { key: 'off', gain: 0 },
] as const;

/**
 * The live music gain (`PUT /api/playout/music-gain`, design §8.5), for example music off during
 * an interview. It is not saved: a backend restart applies the setting `liquidsoap.music_gain`.
 * The slider sends when it is released, not while it moves.
 */
@Component({
  selector: 'app-music-gain',
  imports: [MatButtonModule, MatSliderModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gain-row">
      <mat-slider
        class="slider"
        min="0"
        max="1"
        step="0.05"
        discrete
        [displayWith]="percentText"
        [disabled]="busy()"
      >
        <input
          matSliderThumb
          [value]="value()"
          [attr.aria-label]="'live.gain.label' | translate"
          (change)="onSlider($event)"
        />
      </mat-slider>
      <span class="value">{{ percentText(value()) }}</span>
    </div>
    <div class="presets">
      @for (preset of presets; track preset.key) {
        <button
          matButton="outlined"
          type="button"
          [disabled]="busy()"
          [attr.aria-pressed]="value() === preset.gain"
          (click)="set(preset.gain)"
        >
          {{ 'live.gain.presets.' + preset.key | translate }}
        </button>
      }
    </div>
    @if (error(); as message) {
      <p class="form-error" role="alert">{{ message }}</p>
    }
    @if (gain() === null) {
      <p class="muted">{{ 'live.gain.unknown' | translate }}</p>
    }
  `,
  styles: `
    .gain-row {
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .slider {
      flex: 1 1 auto;
      max-width: 24rem;
    }

    .value {
      min-width: 3.5rem;
      font-variant-numeric: tabular-nums;
    }

    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class MusicGainComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  /** The gain the backend last set; null before Liquidsoap first connected. */
  readonly gain = input<number | null>(null);

  protected readonly presets = GAIN_PRESETS;
  protected readonly value = signal(1);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const gain = this.gain();
      if (gain !== null && !this.busy()) {
        this.value.set(gain);
      }
    });
  }

  protected readonly percentText = (gain: number): string => `${Math.round(gain * 100)} %`;

  protected onSlider(event: Event): void {
    this.set(Number((event.target as HTMLInputElement).value));
  }

  protected set(gain: number): void {
    const previous = this.value();
    this.value.set(gain);
    this.busy.set(true);
    this.error.set(null);
    this.api
      .put('/api/playout/music-gain', { body: { gain } })
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => this.value.set(result.gain),
        error: (error: unknown) => {
          this.value.set(previous);
          this.error.set(errorMessage(error, this.i18n));
        },
      });
  }
}

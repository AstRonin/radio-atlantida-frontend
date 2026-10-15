import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LiveVoiceService } from '../../core/live/live-voice.service';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { ConfirmService } from '../../shared/ui/confirm.service';

/**
 * Live voice controls (design §8.4): choose and test the microphone with its level, go on air,
 * stop. The session itself is held by LiveVoiceService, so it survives leaving this page.
 */
@Component({
  selector: 'app-live-voice',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterLink,
    TranslatePipe,
    StationTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!live.supported) {
      <p class="notice" role="alert">{{ 'live.voice.insecure' | translate }}</p>
    } @else {
      <p class="state" role="status">
        <span class="badge" [class.warn]="backend().state === 'on_air'">
          {{ 'live.states.' + backend().state | translate }}
        </span>
        @if (backend().onAirSince; as since) {
          {{ 'live.voice.onAirSince' | translate: { time: (since | stationTime: 'time-seconds') } }}
        }
        @if (otherPanel()) {
          {{ 'live.voice.otherPanel' | translate }}
        }
      </p>
      @if (live.endReason(); as reason) {
        <p class="form-error" role="alert">{{ 'live.reasons.' + reason | translate }}</p>
      }
      @if (live.available() === false) {
        <p class="form-error" role="alert">{{ 'problems.live_unavailable' | translate }}</p>
      }
      @if (live.error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      <div class="controls">
        @if (live.inputs().length > 0) {
          <mat-form-field class="input-select">
            <mat-label>{{ 'live.voice.input' | translate }}</mat-label>
            <mat-select
              [value]="live.input()"
              [disabled]="live.microphone() === 'opening'"
              (valueChange)="live.openMicrophone($event)"
            >
              @for (input of live.inputs(); track input.deviceId) {
                <mat-option [value]="input.deviceId">{{ input.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (live.microphone() === 'open') {
          <button matButton type="button" (click)="live.closeMicrophone()">
            {{ 'live.voice.closeMicrophone' | translate }}
          </button>
        } @else {
          <button
            matButton
            type="button"
            [disabled]="live.microphone() === 'opening'"
            (click)="live.openMicrophone()"
          >
            {{ 'live.voice.testMicrophone' | translate }}
          </button>
        }
      </div>

      <div class="meter-row">
        <span id="level-label">{{ 'live.voice.level' | translate }}</span>
        <div
          class="meter"
          role="meter"
          aria-labelledby="level-label"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="percent()"
        >
          <div class="meter-fill" [style.width.%]="percent()"></div>
        </div>
        @if (live.level().clipping) {
          <span class="badge warn">{{ 'live.voice.clipping' | translate }}</span>
        }
      </div>
      <p class="muted">{{ 'live.voice.note' | translate }}</p>

      <div class="form-actions">
        @if (live.ownsSession() || live.onAir()) {
          <button matButton="filled" class="stop" type="button" (click)="live.stop()">
            {{ 'live.voice.stop' | translate }}
          </button>
        } @else {
          <button
            matButton="filled"
            type="button"
            [disabled]="live.microphone() !== 'open' || live.phase() !== 'idle'"
            (click)="goOnAir()"
          >
            {{ 'live.voice.goOnAir' | translate }}
          </button>
        }
      </div>
      <p class="muted">
        {{ 'live.voice.ducking' | translate }}
        <a routerLink="/settings">{{ 'nav.settings' | translate }}</a>
      </p>
    }
  `,
  styles: `
    .notice {
      margin: 0;
    }

    .state {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: baseline;
    }

    .input-select {
      min-width: 16rem;
    }

    .meter-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin: 0.5rem 0;
    }

    .meter {
      flex: 1 1 auto;
      max-width: 24rem;
      height: 0.75rem;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }

    .meter-fill {
      height: 100%;
      background: var(--mat-sys-primary);
    }
  `,
})
export class LiveVoiceComponent {
  private readonly confirm = inject(ConfirmService);
  protected readonly live = inject(LiveVoiceService);
  protected readonly backend = this.live.backend;

  protected readonly percent = computed(() => Math.round(this.live.level().level * 100));
  /** A session runs that this panel did not start. */
  protected readonly otherPanel = computed(() => this.live.onAir() && !this.live.ownsSession());

  protected async goOnAir(): Promise<void> {
    if ((await this.live.goOnAir()) !== 'busy') {
      return;
    }
    // Taking the air from another panel (or this one before a reload) is the manager's decision.
    this.confirm
      .confirm({
        title: 'live.takeover.title',
        message: 'live.takeover.message',
        confirmLabel: 'live.takeover.confirm',
        destructive: true,
      })
      .subscribe((confirmed) => {
        if (confirmed) {
          void this.live.goOnAir(true);
        }
      });
  }
}

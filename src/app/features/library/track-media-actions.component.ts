import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import type { Track } from './track-form';
import { MEDIA_LIMITS, MediaRequest, TrackFix, TranscodeOutput } from './track-media';

const OUTPUTS: readonly TranscodeOutput[] = ['copy', 'replace'];

/**
 * Analyse, Fix loudness, and Optimize track for one or several tracks (backend phase 11 §2). A fix
 * is offered for the tracks whose `fixes` list it, and only those are sent: the panel reads what
 * the backend can fix and never decides it.
 */
@Component({
  selector: 'app-track-media-actions',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="media-actions" role="group" [attr.aria-label]="'library.media.title' | translate">
      <div class="row">
        <button
          matButton="outlined"
          type="button"
          [disabled]="blocked() || tooManyToAnalyse()"
          (click)="analyse()"
        >
          {{ 'library.media.analyse' | translate }}
        </button>
        <span class="option">
          <mat-checkbox [formControl]="force">{{ 'library.media.force' | translate }}</mat-checkbox>
          <app-field-hint page="help.library" field="force" />
        </span>
      </div>
      <div class="row">
        <button
          matButton="outlined"
          type="button"
          [disabled]="blocked() || !canFix(loudnessIds())"
          (click)="transcode('loudness', loudnessIds())"
        >
          {{ labelKey('library.media.fixLoudness') | translate: { count: loudnessIds().length } }}
        </button>
        <button
          matButton="outlined"
          type="button"
          [disabled]="blocked() || !canFix(optimizeIds())"
          (click)="transcode('optimize', optimizeIds())"
        >
          {{ labelKey('library.media.optimize') | translate: { count: optimizeIds().length } }}
        </button>
        <div class="output field-row">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ 'library.media.output' | translate }}</mat-label>
            <mat-select [formControl]="output">
              @for (option of outputs; track option) {
                <mat-option [value]="option">{{
                  'library.media.outputs.' + option | translate
                }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.library" field="output" />
        </div>
      </div>
      @if (disabledReason(); as reason) {
        <p class="muted">{{ reason | translate }}</p>
      }
      @if (tooManyToAnalyse()) {
        <p class="muted">
          {{ 'library.media.tooMany' | translate: { max: limits.analyseMax } }}
        </p>
      } @else if (
        loudnessIds().length > limits.transcodeMax || optimizeIds().length > limits.transcodeMax
      ) {
        <p class="muted">
          {{ 'library.media.tooMany' | translate: { max: limits.transcodeMax } }}
        </p>
      }
      @if (lowBitrate() > 0) {
        <p class="muted">{{ 'library.media.lowBitrate' | translate: { count: lowBitrate() } }}</p>
      }
      @if (missing() > 0) {
        <p class="muted">{{ 'library.media.missing' | translate: { count: missing() } }}</p>
      }
    </div>
  `,
  styles: `
    .media-actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: center;
    }

    .option {
      display: inline-flex;
      align-items: center;
    }

    .output {
      min-width: 16rem;
    }

    p {
      margin: 0;
    }
  `,
})
export class TrackMediaActionsComponent {
  readonly tracks = input.required<readonly Track[]>();
  /** An operation of the page runs: one media operation at a time. */
  readonly running = input(false);
  /** Translation key of why the actions are off, for example unsaved changes; null when on. */
  readonly disabledReason = input<string | null>(null);
  /** Shows how many tracks each button acts on; off for a single track. */
  readonly counts = input(true);

  readonly request = output<MediaRequest>();

  protected readonly limits = MEDIA_LIMITS;
  protected readonly outputs = OUTPUTS;
  // Control names are the AnalyseBody and TranscodeBody JSON names.
  protected readonly force = new FormControl(false, { nonNullable: true });
  protected readonly output = new FormControl<TranscodeOutput>('copy', { nonNullable: true });

  protected readonly blocked = computed(
    () => this.running() || this.disabledReason() !== null || this.tracks().length === 0,
  );
  protected readonly tooManyToAnalyse = computed(
    () => this.tracks().length > MEDIA_LIMITS.analyseMax,
  );
  protected readonly loudnessIds = computed(() => this.idsWithFix('loudness'));
  protected readonly optimizeIds = computed(() => this.idsWithFix('optimize'));
  protected readonly lowBitrate = computed(() => this.countIssue('low_bitrate'));
  protected readonly missing = computed(() => this.countIssue('file_missing'));

  protected canFix(ids: readonly number[]): boolean {
    return ids.length > 0 && ids.length <= MEDIA_LIMITS.transcodeMax;
  }

  protected labelKey(key: string): string {
    return this.counts() ? `${key}Count` : key;
  }

  protected analyse(): void {
    this.request.emit({
      kind: 'analyse',
      track_ids: this.tracks().map((track) => track.id),
      force: this.force.value,
    });
  }

  protected transcode(fix: TrackFix, ids: readonly number[]): void {
    this.request.emit({ kind: 'transcode', track_ids: [...ids], fix, output: this.output.value });
  }

  private idsWithFix(fix: TrackFix): number[] {
    return this.tracks()
      .filter((track) => track.fixes.includes(fix))
      .map((track) => track.id);
  }

  private countIssue(issue: Track['quality_issues'][number]): number {
    return this.tracks().filter((track) => track.quality_issues.includes(issue)).length;
  }
}

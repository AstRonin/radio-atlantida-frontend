import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage, controlVersion } from '../../shared/forms/field-errors';
import { OffsetInputComponent } from '../../shared/forms/offset-input.component';
import { SecondsInputComponent } from '../../shared/forms/seconds-input.component';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import { TrackPickerComponent } from '../../shared/pickers/track-picker.component';
import { CLOCK_LIMITS, InsertForm } from './clock-form';

/**
 * One timed insert of a clock (frontend F21 §5.3): its time in the hour with seconds, its start
 * tolerance, and what it plays, a track (with a preview button in the picker) or a track drawn
 * from a playlist.
 */
@Component({
  selector: 'app-clock-insert-row',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    ReactiveFormsModule,
    TranslatePipe,
    OffsetInputComponent,
    PlaylistSelectComponent,
    SecondsInputComponent,
    TrackPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li class="row">
      <div class="fields">
        <app-offset-input
          label="clocks.inserts.offset"
          [control]="group().controls.offset_ms"
          hintPage="help.clocks"
          hintField="offset_ms"
        />
        <app-seconds-input
          label="clocks.inserts.tolerance"
          [control]="group().controls.tolerance_ms"
          [min]="tolerance.min"
          [max]="tolerance.max"
          hintPage="help.clocks"
          hintField="tolerance_ms"
        />
        <mat-button-toggle-group
          [formControl]="group().controls.source"
          [attr.aria-label]="'clocks.inserts.source' | translate"
        >
          <mat-button-toggle value="track">
            {{ 'clocks.inserts.sources.track' | translate }}
          </mat-button-toggle>
          <mat-button-toggle value="playlist">
            {{ 'clocks.inserts.sources.playlist' | translate }}
          </mat-button-toggle>
        </mat-button-toggle-group>
        <span class="spacer"></span>
        <button matButton type="button" (click)="remove.emit()">
          {{ 'common.remove' | translate }}
        </button>
      </div>
      @if (source() === 'track') {
        <app-track-picker
          label="clocks.inserts.track"
          [control]="group().controls.track_id"
          [multiple]="false"
          hintPage="help.clocks"
          hintField="track_id"
        />
      } @else {
        <app-playlist-select
          label="clocks.inserts.playlist"
          [control]="group().controls.playlist_id"
          hintPage="help.clocks"
          hintField="playlist_id"
        />
      }
      @if (sourceMissing()) {
        <p class="form-error" role="alert">{{ 'clocks.inserts.sourceRequired' | translate }}</p>
      }
      @if (warnings().length > 0) {
        <ul class="warnings" role="status">
          @for (message of warnings(); track $index) {
            <li>{{ message }}</li>
          }
        </ul>
      }
    </li>
  `,
  styles: `
    .row {
      padding: 0.5rem 0;
      list-style: none;
    }

    .row + .row {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .fields {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: center;
    }

    .fields > app-offset-input,
    .fields > app-seconds-input {
      flex: 0 1 12rem;
    }

    .spacer {
      flex: 1;
    }

    .warnings {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ClockInsertRowComponent {
  readonly group = input.required<InsertForm>();
  readonly warnings = input<readonly string[]>([]);

  readonly remove = output();

  protected readonly tolerance = CLOCK_LIMITS.toleranceSeconds;
  private readonly version = controlVersion(this.group);
  protected readonly source = computed(() => {
    this.version();
    return this.group().controls.source.value;
  });
  // A server error on the track lands on the picker; the row only says that one is missing.
  private readonly trackError = controlErrorMessage(computed(() => this.group().controls.track_id));
  protected readonly sourceMissing = computed(() => {
    this.version();
    const group = this.group();
    return group.hasError('insertSource') && group.touched && this.trackError() === null;
  });
}

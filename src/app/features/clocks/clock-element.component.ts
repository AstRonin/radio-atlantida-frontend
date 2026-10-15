import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { controlErrorMessage, controlVersion } from '../../shared/forms/field-errors';
import { FillerModeSelectComponent } from '../../shared/forms/filler-mode-select.component';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { PlaylistPickerComponent } from '../../shared/pickers/playlist-picker.component';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { CLOCK_LIMITS, ElementForm, PLACEMENTS } from './clock-form';

/** The fields of one clock element, with move and remove actions. Presentational: no HTTP. */
@Component({
  selector: 'app-clock-element',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    DurationPipe,
    ArtistSelectComponent,
    FieldHintComponent,
    FillerModeSelectComponent,
    NumberInputComponent,
    PlaylistPickerComponent,
    PlaylistSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="element" [attr.aria-labelledby]="'element-title-' + index()">
      <div class="head">
        <h3 class="title" [id]="'element-title-' + index()">
          {{ 'clocks.element.title' | translate: { number: index() + 1 } }}
          @if (isNew()) {
            <span class="badge">{{ 'clocks.element.new' | translate }}</span>
          }
        </h3>
        <span class="actions">
          <button
            matButton
            type="button"
            [disabled]="index() === 0"
            [attr.aria-label]="'clocks.element.moveUpLabel' | translate: { number: index() + 1 }"
            (click)="moveUp.emit()"
          >
            {{ 'clocks.element.moveUp' | translate }}
          </button>
          <button
            matButton
            type="button"
            [disabled]="index() === count() - 1"
            [attr.aria-label]="'clocks.element.moveDownLabel' | translate: { number: index() + 1 }"
            (click)="moveDown.emit()"
          >
            {{ 'clocks.element.moveDown' | translate }}
          </button>
          <button
            matButton
            type="button"
            [attr.aria-label]="'clocks.element.removeLabel' | translate: { number: index() + 1 }"
            (click)="remove.emit()"
          >
            {{ 'clocks.element.remove' | translate }}
          </button>
        </span>
      </div>

      <div class="form-grid">
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'clocks.fields.placement' | translate }}</mat-label>
            <mat-select [formControl]="group().controls.placement">
              @for (placement of placements; track placement) {
                <mat-option [value]="placement">
                  {{ 'clocks.placements.' + placement | translate }}
                </mat-option>
              }
            </mat-select>
            @if (placementError(); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>
          <app-field-hint page="help.clocks" field="placement" />
        </div>
        @if (fixed()) {
          <app-number-input
            [control]="group().controls.fixed_minute"
            label="clocks.fields.fixed_minute"
            [min]="0"
            [max]="limits.minuteMax"
            suffix="forms.units.minutes"
            hintPage="help.clocks"
            hintField="fixed_minute"
          />
          <app-number-input
            [control]="group().controls.fixed_tolerance_ms"
            label="clocks.fields.fixed_tolerance_ms"
            [min]="0"
            [max]="limits.toleranceMax"
            [step]="1000"
            suffix="forms.units.ms"
            hintPage="help.clocks"
            hintField="fixed_tolerance_ms"
          />
        }
        <div>
          <app-number-input
            [control]="group().controls.nominal_duration_ms"
            label="clocks.fields.nominal_duration_ms"
            [min]="1"
            [max]="limits.durationMax"
            [step]="1000"
            suffix="forms.units.ms"
            hintPage="help.clocks"
            hintField="nominal_duration_ms"
          />
          <p class="reading">{{ nominal() | duration }}</p>
        </div>
        <div>
          <app-number-input
            [control]="group().controls.duration_tolerance_ms"
            label="clocks.fields.duration_tolerance_ms"
            [min]="0"
            [max]="limits.toleranceMax"
            [step]="1000"
            suffix="forms.units.ms"
            hintPage="help.clocks"
            hintField="duration_tolerance_ms"
          />
          <p class="reading">
            @if (tolerance() === null) {
              {{ 'clocks.element.defaultTolerance' | translate }}
            } @else {
              ± {{ tolerance() | duration }}
            }
          </p>
        </div>
      </div>
      <app-playlist-picker
        [control]="group().controls.playlist_ids"
        label="clocks.fields.playlist_ids"
        hintPage="help.clocks"
        hintField="playlist_ids"
      />
      <div class="form-grid">
        <app-filler-mode-select
          [control]="group().controls.filler_mode"
          hintPage="help.clocks"
          hintField="filler_mode"
        />
        @switch (fillerMode()) {
          @case ('playlist') {
            <app-playlist-select
              label="clocks.fields.filler_playlist"
              [control]="group().controls.filler_source_id"
              hintPage="help.clocks"
              hintField="filler_source_id"
            />
          }
          @case ('artist') {
            <app-artist-select
              label="clocks.fields.filler_artist"
              [control]="group().controls.filler_source_id"
              hintPage="help.clocks"
              hintField="filler_source_id"
            />
          }
        }
      </div>
      @for (message of warnings(); track $index) {
        <p class="warning" role="status">{{ message }}</p>
      }
    </fieldset>
  `,
  styles: `
    .element {
      margin: 0 0 1rem;
      padding: 0.5rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .title {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
    }

    .reading {
      margin: -1rem 0 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .warning {
      margin: 0.25rem 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ClockElementComponent {
  readonly group = input.required<ElementForm>();
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  /** Warnings of the last dry check for this element, already translated. */
  readonly warnings = input<readonly string[]>([]);

  readonly moveUp = output();
  readonly moveDown = output();
  readonly remove = output();

  protected readonly placements = PLACEMENTS;
  protected readonly limits = CLOCK_LIMITS;

  private readonly version = controlVersion(this.group);
  protected readonly placementError = controlErrorMessage(
    computed(() => this.group().controls.placement),
  );
  protected readonly fixed = computed(() => {
    this.version();
    return this.group().controls.placement.value === 'fixed';
  });
  protected readonly fillerMode = computed(() => {
    this.version();
    return this.group().controls.filler_mode.value;
  });
  protected readonly nominal = computed(() => {
    this.version();
    return this.group().controls.nominal_duration_ms.value;
  });
  protected readonly tolerance = computed(() => {
    this.version();
    return this.group().controls.duration_tolerance_ms.value;
  });
  protected readonly isNew = computed(() => {
    this.version();
    return this.group().controls.id.value === null;
  });
}

import { ChangeDetectionStrategy, Component, computed, effect, input } from '@angular/core';
import { controlErrorMessage, controlVersion } from '../../shared/forms/field-errors';
import { FillerModeSelectComponent } from '../../shared/forms/filler-mode-select.component';
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import type { FallbackGroup } from './settings-form';

/**
 * The global fallback filler (`filler.fallback`): random, a playlist, or an artist, with the
 * playlist or artist picker shown only for its mode (design §6.2).
 */
@Component({
  selector: 'app-fallback-filler-input',
  imports: [ArtistSelectComponent, FillerModeSelectComponent, PlaylistSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fields">
      <app-filler-mode-select
        [control]="group().controls.mode"
        modes="fallback"
        [label]="label()"
        hintPage="help.settings"
        hintField="filler.fallback"
      />
      @switch (mode()) {
        @case ('playlist') {
          <app-playlist-select
            [control]="group().controls.source_id"
            label="settings.fallback.playlist"
          />
        }
        @case ('artist') {
          <app-artist-select
            [control]="group().controls.source_id"
            label="settings.fallback.artist"
          />
        }
      }
    </div>
    @if (error(); as message) {
      <p class="form-error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 0 1rem;
    }

    .form-error {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class FallbackFillerInputComponent {
  readonly group = input.required<FallbackGroup>();
  /** Translation key of the mode label. */
  readonly label = input.required<string>();

  private readonly version = controlVersion(this.group);
  /** A missing source, or a backend error on the whole value (the API names the field `value`). */
  protected readonly error = controlErrorMessage(this.group);

  protected readonly mode = computed(() => {
    this.version();
    return this.group().controls.mode.value;
  });

  constructor() {
    // A source of the other kind is not valid for the new mode, so the operator's change of mode
    // clears it. A reset (discard, or after a save) leaves the group pristine and keeps its source.
    let previous: unknown;
    effect(() => {
      const mode = this.mode();
      const group = this.group();
      if (previous !== undefined && mode !== previous && group.dirty) {
        group.controls.source_id.setValue(null);
      }
      previous = mode;
    });
  }
}

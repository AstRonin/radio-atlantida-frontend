import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  ClockRuleInputComponent,
  clockRuleLabel,
} from '../../shared/forms/clock-rule-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { CLOCK_LIMITS, Playlist, PlaylistRowForm, effectiveRule } from './clock-form';

/**
 * One playlist of a clock (frontend F21 §5.3): the playlist with its type and track count, its own
 * placement rule, an override of that rule for this clock, and the share of a fill playlist.
 */
@Component({
  selector: 'app-clock-playlist-row',
  imports: [
    MatButtonModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
    TranslatePipe,
    ClockRuleInputComponent,
    FieldHintComponent,
    NumberInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li class="row" [attr.aria-label]="name()">
      <div class="head">
        <span class="name">{{ name() }}</span>
        @if (playlist(); as item) {
          <span class="badge">{{ item.type.name }}</span>
          <span class="muted">
            {{ 'clocks.playlists.trackCount' | translate: { count: item.track_count } }}
          </span>
        }
        <span class="badge rule">{{ ruleLabel() }}</span>
        @if (share(); as percent) {
          <span class="share">{{ 'clocks.playlists.share' | translate: { percent } }}</span>
        }
        <span class="spacer"></span>
        <button
          matIconButton
          type="button"
          [disabled]="index() === 0"
          [attr.aria-label]="'clocks.playlists.moveUp' | translate: { name: name() }"
          (click)="moveUp.emit()"
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          matIconButton
          type="button"
          [disabled]="index() === count() - 1"
          [attr.aria-label]="'clocks.playlists.moveDown' | translate: { name: name() }"
          (click)="moveDown.emit()"
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button matButton type="button" (click)="remove.emit()">
          {{ 'common.remove' | translate }}
        </button>
      </div>

      <div class="fields">
        <div class="field-row">
          <mat-slide-toggle [formControl]="group().controls.override">
            {{ 'clocks.playlists.override' | translate }}
          </mat-slide-toggle>
          <app-field-hint page="help.clocks" field="override" />
        </div>
        @if (overridden()) {
          <app-clock-rule-input
            [rule]="group().controls.clock_rule"
            [count]="group().controls.clock_count"
            [inherited]="inherited()"
            hintPage="help.clocks"
          />
        }
        @if (isFill()) {
          <app-number-input
            label="clocks.playlists.weight"
            [control]="group().controls.fill_weight"
            [min]="weight.min"
            [max]="weight.max"
            hintPage="help.clocks"
            hintField="fill_weight"
          />
        }
      </div>

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
      padding: 0.75rem 1rem;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      list-style: none;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }

    .name {
      font: var(--mat-sys-title-small);
    }

    .spacer {
      flex: 1;
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 0 1rem;
      align-items: start;
      margin-top: 0.5rem;
    }

    .warnings {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ClockPlaylistRowComponent {
  private readonly i18n = inject(I18nService);

  readonly group = input.required<PlaylistRowForm>();
  /** The playlist from the catalog; undefined while it loads or when it is gone. */
  readonly playlist = input<Playlist | undefined>(undefined);
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  /** The share of a fill row in percent, when the fill rows have weights. */
  readonly share = input<number | null>(null);
  readonly warnings = input<readonly string[]>([]);

  readonly moveUp = output();
  readonly moveDown = output();
  readonly remove = output();

  protected readonly weight = CLOCK_LIMITS.weight;
  private readonly version = controlVersion(this.group);

  protected readonly name = computed(
    () =>
      this.playlist()?.name ??
      this.i18n.translate('clocks.playlists.unknown', {
        id: this.group().controls.playlist_id.value,
      }),
  );
  protected readonly overridden = computed(() => {
    this.version();
    return this.group().controls.override.value;
  });
  protected readonly isFill = computed(() => {
    this.version();
    return effectiveRule(this.group()) === 'fill';
  });
  protected readonly inherited = computed(() => {
    const { inherited_rule, inherited_count } = this.group().controls;
    return { rule: inherited_rule.value, count: inherited_count.value };
  });
  protected readonly ruleLabel = computed(() => {
    this.version();
    const value = this.group().getRawValue();
    return value.override && value.clock_rule !== null
      ? clockRuleLabel(this.i18n, value.clock_rule, value.clock_count)
      : clockRuleLabel(this.i18n, value.inherited_rule, value.inherited_count);
  });
}

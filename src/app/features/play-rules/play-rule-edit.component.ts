import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { Observable, concatMap, of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SettingsService } from '../../core/settings/settings.service';
import { controlVersion } from '../../shared/forms/field-errors';
import { IntervalInputComponent } from '../../shared/forms/interval-input.component';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { TimeInputComponent } from '../../shared/forms/time-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { WeekdaysInputComponent } from '../../shared/forms/weekdays-input.component';
import { PlaylistPickerComponent } from '../../shared/pickers/playlist-picker.component';
import { TrackPickerComponent } from '../../shared/pickers/track-picker.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  PLAY_RULE_LIMITS,
  PlayRule,
  intervalMaxMinutes,
  playRuleBody,
  playRuleForm,
  playRuleFormValue,
} from './play-rule-form';

/**
 * Creates or edits a play rule (design §7.3): its limits, and the tracks and playlists it applies
 * to. The rule and its targets are saved by two requests; after a create, the page keeps the new
 * ID, so a failed second request is retried as an edit, not a second create.
 */
@Component({
  selector: 'app-play-rule-edit',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    IntervalInputComponent,
    NumberInputComponent,
    PageHeaderComponent,
    PlaylistPickerComponent,
    TextInputComponent,
    TimeInputComponent,
    TrackPickerComponent,
    WeekdaysInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      [titleKey]="ruleId() === null ? 'playRules.edit.createTitle' : 'playRules.edit.editTitle'"
      helpPage="help.play-rules"
    />

    @if (rule.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()">
      <section class="page-section">
        <app-text-input
          [control]="form.controls.name"
          label="playRules.fields.name"
          [maxLength]="limits.nameMax"
          hintPage="help.play-rules"
          hintField="name"
        />
      </section>

      <section class="page-section" aria-labelledby="limits-heading">
        <h2 id="limits-heading" class="section-title">{{ 'playRules.edit.limits' | translate }}</h2>
        <p class="muted">{{ 'playRules.edit.limitsNote' | translate }}</p>
        <div class="form-grid">
          <app-time-input
            [control]="form.controls.window_from"
            label="playRules.fields.window_from"
            hintPage="help.play-rules"
            hintField="window_from"
          />
          <app-time-input
            [control]="form.controls.window_to"
            label="playRules.fields.window_to"
            hintPage="help.play-rules"
            hintField="window_to"
          />
        </div>
        @if (groupError('sameWindow')) {
          <p class="form-error" role="alert">{{ 'playRules.errors.sameWindow' | translate }}</p>
        }
        <app-weekdays-input
          [control]="form.controls.weekdays"
          hintPage="help.play-rules"
          hintField="weekdays"
        />
        <p class="muted">{{ 'playRules.edit.weekdaysNote' | translate }}</p>
        <div class="form-grid">
          <app-interval-input
            [control]="form.controls.min_interval_minutes"
            label="playRules.fields.min_interval_minutes"
            hintPage="help.play-rules"
            hintField="min_interval_minutes"
          />
          <app-interval-input
            [control]="form.controls.artist_min_interval_minutes"
            label="playRules.fields.artist_min_interval_minutes"
            hintPage="help.play-rules"
            hintField="artist_min_interval_minutes"
          />
          <app-number-input
            [control]="form.controls.max_per_hour"
            label="playRules.fields.max_per_hour"
            [min]="1"
            [max]="limits.perHourMax"
            hintPage="help.play-rules"
            hintField="max_per_hour"
          />
        </div>
        @if (groupError('atLeastOne')) {
          <p class="form-error" role="alert">{{ 'playRules.errors.atLeastOne' | translate }}</p>
        }
        <app-text-input
          [control]="form.controls.notes"
          label="playRules.fields.notes"
          [maxLength]="limits.notesMax"
          [multiline]="true"
          hintPage="help.play-rules"
          hintField="notes"
        />
      </section>

      <section class="page-section" aria-labelledby="targets-heading">
        <h2 id="targets-heading" class="section-title">
          {{ 'playRules.edit.targets' | translate }}
        </h2>
        <app-playlist-picker
          [control]="form.controls.playlist_ids"
          label="playRules.fields.playlist_ids"
          hintPage="help.play-rules"
          hintField="playlist_ids"
        />
        <app-track-picker
          [control]="form.controls.track_ids"
          label="playRules.fields.track_ids"
          hintPage="help.play-rules"
          hintField="track_ids"
        />
      </section>

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button matButton="filled" type="submit" [disabled]="busy() || invalid()">
          {{ 'common.save' | translate }}
        </button>
        <a matButton routerLink="/play-rules">{{ 'common.back' | translate }}</a>
      </div>
    </form>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }
  `,
})
export default class PlayRuleEditComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter; absent on `play-rules/new`. */
  readonly id = input<string>();

  protected readonly limits = PLAY_RULE_LIMITS;
  // The intervals are capped by the play log retention, as the backend caps them.
  protected readonly form = playRuleForm(
    intervalMaxMinutes(inject(SettingsService).get('retention.play_log_days')?.value),
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly createdId = signal<number | null>(null);
  protected readonly ruleId = computed(() => {
    const id = this.id();
    return this.createdId() ?? (id === undefined ? null : Number(id));
  });

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });

  protected readonly rule = rxResource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : Number(id);
    },
    stream: ({ params: id }) => this.api.get('/api/play-rules/{id}', { path: { id } }),
  });
  protected readonly loadError = computed(() =>
    this.rule.status() === 'error' ? errorMessage(this.rule.error(), this.i18n) : null,
  );

  constructor() {
    effect(() => {
      if (this.rule.hasValue()) {
        const rule = this.rule.value();
        untracked(() => this.fill(rule));
      }
    });
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  protected groupError(key: string): boolean {
    this.version();
    return this.form.hasError(key) && (this.form.touched || this.form.dirty);
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const body = playRuleBody(this.form);
    const targets = {
      track_ids: this.form.controls.track_ids.value ?? [],
      playlist_ids: this.form.controls.playlist_ids.value ?? [],
    };
    const id = this.ruleId();
    const saveRule: Observable<PlayRule> =
      id === null
        ? this.api.post('/api/play-rules', { body })
        : this.api.put('/api/play-rules/{id}', { path: { id }, body });

    this.busy.set(true);
    this.error.set(null);
    saveRule
      .pipe(
        concatMap((saved) => {
          if (id === null) {
            this.rememberCreated(saved.id);
          }
          const unchanged =
            sameIds(saved.track_ids, targets.track_ids) &&
            sameIds(saved.playlist_ids, targets.playlist_ids);
          return unchanged
            ? of(saved)
            : this.api.put('/api/play-rules/{id}/targets', {
                path: { id: saved.id },
                body: targets,
              });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.form.markAsPristine();
          void this.router.navigateByUrl('/play-rules');
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }

  private fill(rule: PlayRule): void {
    this.form.reset(playRuleFormValue(rule));
  }

  // The URL then names the rule, so a reload opens it for editing instead of a new form.
  private rememberCreated(id: number): void {
    this.createdId.set(id);
    this.location.replaceState(`/play-rules/${id}`);
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

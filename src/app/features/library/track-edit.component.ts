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
import { Observable, concatMap, map, of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatDurationMs } from '../../core/time/duration';
import { controlVersion } from '../../shared/forms/field-errors';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { PlaylistTypeSelectComponent } from '../../shared/forms/playlist-type-select.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { PlayRulePickerComponent } from '../../shared/pickers/play-rule-picker.component';
import { PlaylistPickerComponent } from '../../shared/pickers/playlist-picker.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import { TRACK_LIMITS, Track, trackBody, trackForm, trackFormValue } from './track-form';
import { TrackQualityComponent } from './track-quality.component';

/**
 * Creates or edits a track: its metadata, its file path under the media root, its playlists, and
 * its play rules. The file is not uploaded here; it must already be in the media folder (the
 * import is a later phase). Format and quality are shown read-only.
 */
@Component({
  selector: 'app-track-edit',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ArtistSelectComponent,
    NumberInputComponent,
    PageHeaderComponent,
    PlayButtonComponent,
    PlayRulePickerComponent,
    PlaylistPickerComponent,
    PlaylistTypeSelectComponent,
    TextInputComponent,
    TrackQualityComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      [title]="trackId() === null ? 'library.edit.createTitle' : 'library.edit.editTitle'"
      helpPage="help.library"
    >
      @if (stored(); as track) {
        <app-play-button [track]="track" />
      }
    </app-page-header>

    @if (track.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()">
      <div class="form-grid">
        <app-text-input
          [control]="form.controls.title"
          label="library.fields.title"
          [maxLength]="limits.titleMax"
          hintPage="help.library"
          hintField="title"
        />
        <app-artist-select
          [control]="form.controls.artist_id"
          label="library.fields.artist_id"
          hintPage="help.library"
          hintField="artist_id"
        />
        <app-playlist-type-select
          [control]="form.controls.type_id"
          label="library.fields.type_id"
          hintPage="help.library"
          hintField="type_id"
        />
      </div>
      <app-text-input
        [control]="form.controls.file_path"
        label="library.fields.file_path"
        hint="library.edit.filePathHint"
        [maxLength]="limits.pathMax"
        [spellcheck]="false"
        hintPage="help.library"
        hintField="file_path"
      />
      <div class="form-grid">
        <app-number-input
          [control]="form.controls.duration_ms"
          label="library.fields.duration_ms"
          [min]="1"
          [max]="limits.durationMaxMs"
          suffix="forms.units.ms"
          hintPage="help.library"
          hintField="duration_ms"
        />
        <p class="muted duration">
          @if (duration(); as text) {
            {{ 'library.edit.durationIs' | translate: { duration: text } }}
          } @else {
            {{ 'library.edit.durationEmpty' | translate }}
          }
        </p>
      </div>
      <app-playlist-picker
        [control]="form.controls.playlist_ids"
        label="library.fields.playlist_ids"
        hintPage="help.library"
        hintField="playlist_ids"
      />
      <app-play-rule-picker
        [control]="form.controls.rule_ids"
        label="library.fields.rule_ids"
        hintPage="help.library"
        hintField="rule_ids"
      />

      @if (stored(); as track) {
        <section class="page-section" aria-labelledby="file-heading">
          <h2 id="file-heading" class="section-title">{{ 'library.edit.file' | translate }}</h2>
          <dl class="facts">
            <dt>{{ 'library.fields.format' | translate }}</dt>
            <dd>{{ track.format ?? '–' }}</dd>
            <dt>{{ 'library.fields.bitrate' | translate }}</dt>
            <dd>
              @if (track.bitrate) {
                {{ 'library.edit.kbps' | translate: { kbps: kbps(track.bitrate) } }}
              } @else {
                –
              }
            </dd>
            <dt>{{ 'library.fields.sample_rate' | translate }}</dt>
            <dd>
              @if (track.sample_rate) {
                {{ 'library.edit.hz' | translate: { hz: track.sample_rate } }}
              } @else {
                –
              }
            </dd>
            <dt>{{ 'library.fields.quality_ok' | translate }}</dt>
            <dd><app-track-quality [track]="track" [detailed]="true" /></dd>
          </dl>
        </section>
      }
      <app-text-input
        [control]="form.controls.quality_notes"
        label="library.fields.quality_notes"
        [maxLength]="limits.notesMax"
        [multiline]="true"
        hintPage="help.library"
        hintField="quality_notes"
      />

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button matButton="filled" type="submit" [disabled]="busy() || invalid()">
          {{ 'common.save' | translate }}
        </button>
        <a matButton routerLink="/library">{{ 'common.back' | translate }}</a>
      </div>
    </form>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .duration {
      align-self: center;
      margin: 0 0 1.25rem;
    }

    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      margin: 0;
    }

    .facts dt {
      color: var(--mat-sys-on-surface-variant);
    }

    .facts dd {
      margin: 0;
    }
  `,
})
export default class TrackEditComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter; absent on `library/new`. */
  readonly id = input<string>();

  protected readonly limits = TRACK_LIMITS;
  protected readonly form = trackForm();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The track as last read or saved; null for a new one. */
  protected readonly stored = signal<Track | null>(null);
  protected readonly trackId = computed(() => {
    const id = this.id();
    return this.stored()?.id ?? (id === undefined ? null : Number(id));
  });

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });
  protected readonly duration = computed(() => {
    this.version();
    const ms = this.form.controls.duration_ms.value;
    return ms !== null && this.form.controls.duration_ms.valid ? formatDurationMs(ms) : null;
  });

  protected readonly track = rxResource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : Number(id);
    },
    stream: ({ params: id }) => this.api.get('/api/tracks/{id}', { path: { id } }),
  });
  protected readonly loadError = computed(() =>
    this.track.status() === 'error' ? errorMessage(this.track.error(), this.i18n) : null,
  );

  constructor() {
    effect(() => {
      if (this.track.hasValue()) {
        const track = this.track.value();
        untracked(() => {
          this.stored.set(track);
          this.form.reset(trackFormValue(track));
        });
      }
    });
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  protected kbps(bitsPerSecond: number): number {
    return Math.round(bitsPerSecond / 1000);
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const stored = this.stored();
    const body = trackBody(this.form, stored);
    const ruleIds = this.form.controls.rule_ids.value ?? [];
    const saveTrack: Observable<Track> = stored
      ? this.api.put('/api/tracks/{id}', { path: { id: stored.id }, body })
      : this.api.post('/api/tracks', { body });

    this.busy.set(true);
    this.error.set(null);
    saveTrack
      .pipe(
        concatMap((saved) => {
          if (!stored) {
            // A failed rules request is then retried as an edit, not as a second create.
            this.stored.set(saved);
            this.location.replaceState(`/library/${saved.id}`);
          }
          return sameIds(saved.play_rule_ids, ruleIds)
            ? of(saved)
            : this.api
                .put('/api/tracks/{id}/play-rules', {
                  path: { id: saved.id },
                  body: { rule_ids: ruleIds },
                })
                .pipe(map(() => saved));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.form.markAsPristine();
          void this.router.navigateByUrl('/library');
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

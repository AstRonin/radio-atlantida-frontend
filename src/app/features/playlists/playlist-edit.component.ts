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
import { Location } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, concatMap, expand, forkJoin, map, of, reduce } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { PlaylistTypeSelectComponent } from '../../shared/forms/playlist-type-select.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { PlayRulePickerComponent } from '../../shared/pickers/play-rule-picker.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlaylistTracksComponent } from './playlist-tracks.component';

type Playlist = ApiSchema<'Playlist'>;
type Track = ApiSchema<'Track'>;

export const PLAYLIST_NAME_MAX = 200;
/** The largest page `GET /api/tracks` returns; the members are read in pages of this size. */
export const MEMBER_PAGE_SIZE = 500;

interface Loaded {
  playlist: Playlist;
  members: Track[];
}

/**
 * Creates or edits a playlist: name, type (required), play rules, and its tracks. The playlist,
 * its rules, and its tracks are separate requests (design §6.4); only the changed parts are sent.
 */
@Component({
  selector: 'app-playlist-edit',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    PageHeaderComponent,
    PlayRulePickerComponent,
    PlaylistTracksComponent,
    PlaylistTypeSelectComponent,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      [title]="stored() === null ? 'playlists.edit.createTitle' : 'playlists.edit.editTitle'"
      helpPage="help.playlists"
    />

    @if (loaded.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()">
      <div class="form-grid">
        <app-text-input
          [control]="form.controls.name"
          label="playlists.fields.name"
          [maxLength]="nameMax"
          hintPage="help.playlists"
          hintField="name"
        />
        <app-playlist-type-select
          [control]="form.controls.type_id"
          label="playlists.fields.type_id"
          hintPage="help.playlists"
          hintField="type_id"
        />
      </div>
      <app-play-rule-picker
        [control]="form.controls.rule_ids"
        label="playlists.fields.rule_ids"
        hintPage="help.playlists"
        hintField="rule_ids"
      />
      <app-playlist-tracks [control]="form.controls.track_ids" [members]="members()" />

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button matButton="filled" type="submit" [disabled]="busy() || invalid()">
          {{ 'common.save' | translate }}
        </button>
        <a matButton routerLink="/playlists">{{ 'common.back' | translate }}</a>
      </div>
    </form>
  `,
})
export default class PlaylistEditComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter; absent on `playlists/new`. */
  readonly id = input<string>();

  protected readonly nameMax = PLAYLIST_NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The playlist as last read or saved; null for a new one. */
  protected readonly stored = signal<Playlist | null>(null);
  protected readonly members = signal<readonly Track[]>([]);
  /** Track IDs as stored, to send the membership only when it changed. */
  private storedTrackIds: readonly number[] = [];

  protected readonly form = new FormGroup({
    name: new FormControl<string | null>('', [
      Validators.required,
      Validators.maxLength(PLAYLIST_NAME_MAX),
    ]),
    type_id: new FormControl<number | null>(null, Validators.required),
    rule_ids: new FormControl<number[] | null>([]),
    track_ids: new FormControl<number[] | null>([]),
  });

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });

  protected readonly loaded = rxResource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : Number(id);
    },
    stream: ({ params: id }) =>
      forkJoin({
        playlist: this.api.get('/api/playlists/{id}', { path: { id } }),
        members: this.readMembers(id),
      }),
  });
  protected readonly loadError = computed(() =>
    this.loaded.status() === 'error' ? errorMessage(this.loaded.error(), this.i18n) : null,
  );

  constructor() {
    effect(() => {
      if (this.loaded.hasValue()) {
        const loaded = this.loaded.value();
        untracked(() => this.fill(loaded));
      }
    });
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body = { name: (value.name ?? '').trim(), type_id: value.type_id ?? 0 };
    const ruleIds = value.rule_ids ?? [];
    const trackIds = value.track_ids ?? [];
    const stored = this.stored();

    const savePlaylist: Observable<Playlist> = !stored
      ? this.api.post('/api/playlists', { body })
      : this.form.controls.name.dirty || this.form.controls.type_id.dirty
        ? this.api.put('/api/playlists/{id}', { path: { id: stored.id }, body })
        : of(stored);

    this.busy.set(true);
    this.error.set(null);
    savePlaylist
      .pipe(
        concatMap((saved) => {
          if (!stored) {
            // Later failures are then retried as edits of this playlist, not as a second create.
            this.stored.set(saved);
            this.location.replaceState(`/playlists/${saved.id}`);
          }
          const rules: Observable<unknown> = sameIds(saved.play_rule_ids, ruleIds)
            ? of(null)
            : this.api.put('/api/playlists/{id}/play-rules', {
                path: { id: saved.id },
                body: { rule_ids: ruleIds },
              });
          return rules.pipe(map(() => saved));
        }),
        concatMap((saved) =>
          sameIds(this.storedTrackIds, trackIds)
            ? of(saved)
            : this.api.put('/api/playlists/{id}/tracks', {
                path: { id: saved.id },
                body: { track_ids: trackIds },
              }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.form.markAsPristine();
          void this.router.navigateByUrl('/playlists');
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }

  private fill({ playlist, members }: Loaded): void {
    this.stored.set(playlist);
    this.members.set(members);
    this.storedTrackIds = members.map((track) => track.id);
    this.form.reset({
      name: playlist.name,
      type_id: playlist.type.id,
      rule_ids: playlist.play_rule_ids,
      track_ids: [...this.storedTrackIds],
    });
  }

  // Every page of the playlist's tracks; the membership request needs the whole set.
  private readMembers(id: number): Observable<Track[]> {
    const page = (cursor?: string) =>
      this.api.get('/api/tracks', {
        query: { playlist_id: id, limit: MEMBER_PAGE_SIZE, cursor },
      });
    return page().pipe(
      expand((result) => (result.next_cursor ? page(result.next_cursor) : EMPTY)),
      reduce((tracks: Track[], result) => [...tracks, ...result.items], []),
    );
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormRecord } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Setting, SettingsService } from '../../core/settings/settings.service';
import { controlVersion } from '../../shared/forms/field-errors';
import { setServerError } from '../../shared/forms/server-errors';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { SettingFieldComponent } from './setting-field.component';
import {
  GROUP_ORDER,
  SecretStatus,
  SettingGroup,
  controlValue,
  isChanged,
  resetValue,
  settingControl,
} from './settings-form';

interface Section {
  group: SettingGroup;
  settings: Setting[];
  secrets: SecretStatus[];
}

interface SaveResult {
  setting: Setting;
  error: unknown;
}

/**
 * The station settings (design §6.3), one section per group. Each value is saved by its own
 * request; a value that needs a reconnect is announced before saving. Secrets are only listed as
 * set or not set: the panel never shows or edits them.
 */
@Component({
  selector: 'app-settings-page',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    RouterLink,
    TranslatePipe,
    PageHeaderComponent,
    SettingFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="settings.title" helpPage="help.settings">
      <a matButton routerLink="/playlist-types">{{ 'settings.playlistTypesLink' | translate }}</a>
    </app-page-header>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">
        {{ message }}
        <button matButton type="button" (click)="reload()">{{ 'common.retry' | translate }}</button>
      </p>
    }

    @for (section of sections(); track section.group) {
      <section class="page-section group" [attr.aria-labelledby]="'group-' + section.group">
        <h2 class="group-title" [id]="'group-' + section.group">
          {{ 'settings.groups.' + section.group | translate }}
        </h2>
        @for (setting of section.settings; track setting.key) {
          @if (controls()[setting.key]; as control) {
            <app-setting-field [setting]="setting" [control]="control" />
          }
        }
        @if (section.secrets.length > 0) {
          <div class="secrets">
            <h3 class="secrets-title">{{ 'settings.secrets.title' | translate }}</h3>
            <p class="muted">{{ 'settings.secrets.note' | translate }}</p>
            <ul class="secret-list">
              @for (secret of section.secrets; track secret.name) {
                <li>
                  <code>{{ secret.name }}</code>
                  <span class="badge" [class.warn]="!secret.is_set">
                    {{
                      (secret.is_set ? 'settings.secrets.set' : 'settings.secrets.notSet')
                        | translate
                    }}
                  </span>
                </li>
              }
            </ul>
          </div>
        }
      </section>
    }
    @if (secretsError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    @if (sections().length > 0) {
      <div class="save-bar">
        <p class="status" role="status">
          @if (result(); as text) {
            {{ text }}
          } @else if (changedCount() > 0) {
            {{ 'settings.unsaved' | translate: { count: changedCount() } }}
          }
        </p>
        @if (saveErrors().length > 0) {
          <ul class="form-error" role="alert">
            @for (line of saveErrors(); track line) {
              <li>{{ line }}</li>
            }
          </ul>
        }
        <div class="form-actions">
          <button
            matButton="filled"
            type="button"
            [disabled]="busy() || changedCount() === 0 || invalid()"
            (click)="save()"
          >
            {{ 'common.save' | translate }}
          </button>
          <button
            matButton
            type="button"
            [disabled]="busy() || changedCount() === 0"
            (click)="discard()"
          >
            {{ 'settings.discard' | translate }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .group {
      max-width: 48rem;
    }

    .group-title {
      margin: 0 0 0.75rem;
      font: var(--mat-sys-title-large);
    }

    .secrets {
      padding: 0.5rem 0.75rem;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 4px;
    }

    .secrets-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .secret-list {
      margin: 0.25rem 0 0;
      padding: 0;
      list-style: none;
    }

    .secret-list li {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      min-height: 1.75rem;
    }

    .save-bar {
      position: sticky;
      bottom: 0;
      padding: 0.5rem 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }

    .status {
      margin: 0;
      min-height: 1.25rem;
    }
  `,
})
export default class SettingsPageComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly settingsService = inject(SettingsService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly form = new FormRecord<AbstractControl>({});
  /** The controls by setting key. Keys contain dots, so they are never read with `form.get()`. */
  protected readonly controls = signal<Readonly<Record<string, AbstractControl>>>({});
  protected readonly busy = signal(false);
  protected readonly result = signal<string | null>(null);
  protected readonly saveErrors = signal<readonly string[]>([]);

  private readonly loaded = rxResource({ stream: () => this.settingsService.refresh() });
  private readonly secrets = rxResource({
    stream: () => this.api.get('/api/settings/secrets').pipe(map((list) => list.items)),
  });

  protected readonly loading = computed(() => this.loaded.isLoading() || this.secrets.isLoading());
  protected readonly loadError = computed(() =>
    this.loaded.status() === 'error' ? errorMessage(this.loaded.error(), this.i18n) : null,
  );
  protected readonly secretsError = computed(() =>
    this.secrets.status() === 'error' ? errorMessage(this.secrets.error(), this.i18n) : null,
  );

  // Rendered from the service, which a save updates, so the default flags follow each save.
  private readonly settings = computed(() =>
    this.loaded.hasValue() ? this.settingsService.settings() : [],
  );

  protected readonly sections = computed((): Section[] => {
    const settings = this.settings();
    const secrets = this.secrets.hasValue() ? this.secrets.value() : [];
    const groups = [
      ...GROUP_ORDER,
      ...new Set(settings.map((setting) => setting.group).filter((g) => !GROUP_ORDER.includes(g))),
    ];
    return groups
      .map((group) => ({
        group,
        settings: settings.filter((setting) => setting.group === group),
        secrets: secrets.filter((secret) => secret.group === group),
      }))
      .filter((section) => section.settings.length > 0 || section.secrets.length > 0);
  });

  private readonly version = controlVersion(signal(this.form));
  protected readonly changed = computed(() => {
    this.version();
    const controls = this.controls();
    return this.settings().filter((setting) => {
      const control = controls[setting.key];
      return control !== undefined && isChanged(setting, control);
    });
  });
  protected readonly changedCount = computed(() => this.changed().length);
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });

  constructor() {
    // Controls are made once per setting; later updates of the service (a save) keep them.
    effect(() => {
      const settings = this.settings();
      untracked(() => this.addControls(settings));
    });
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.changed().length > 0;
  }

  protected reload(): void {
    this.loaded.reload();
    this.secrets.reload();
  }

  protected discard(): void {
    for (const setting of this.changed()) {
      this.controls()[setting.key]?.reset(resetValue(setting));
    }
    this.result.set(null);
    this.saveErrors.set([]);
  }

  protected save(): void {
    const changed = this.changed();
    if (changed.length === 0 || this.form.invalid || this.busy()) {
      return;
    }
    const reconnect = changed.filter((setting) => setting.apply === 'reconnect');
    const confirmed: Observable<boolean> =
      reconnect.length === 0
        ? of(true)
        : this.confirm.confirm({
            title: 'settings.reconnect.title',
            message: 'settings.reconnect.message',
            params: { settings: reconnect.map((setting) => this.label(setting)).join(', ') },
            confirmLabel: 'common.save',
          });
    confirmed.subscribe((ok) => ok && this.saveAll(changed));
  }

  private saveAll(changed: readonly Setting[]): void {
    this.busy.set(true);
    this.result.set(null);
    this.saveErrors.set([]);
    from(changed)
      .pipe(
        concatMap((setting) => {
          const control = this.controls()[setting.key];
          const value = control ? controlValue(setting, control) : setting.value;
          return this.settingsService.save(setting.key, value).pipe(
            map(({ setting: saved }): SaveResult => ({ setting: saved, error: null })),
            catchError((error: unknown) => of<SaveResult>({ setting, error })),
          );
        }),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.busy.set(false);
        const errors: string[] = [];
        for (const { setting, error } of results) {
          const control = this.controls()[setting.key];
          if (!error) {
            control?.reset(resetValue(setting));
            continue;
          }
          if (control && error instanceof ApiProblem) {
            for (const fieldError of error.errors) {
              setServerError(control, fieldError);
            }
          }
          errors.push(`${this.label(setting)}: ${errorMessage(error, this.i18n)}`);
        }
        this.saveErrors.set(errors);
        const saved = results.length - errors.length;
        this.result.set(saved > 0 ? this.i18n.translate('settings.saved', { count: saved }) : null);
      });
  }

  private addControls(settings: readonly Setting[]): void {
    const current = this.controls();
    const added = settings.filter((setting) => !(setting.key in current));
    if (added.length === 0) {
      return;
    }
    const next = { ...current };
    for (const setting of added) {
      const control = settingControl(setting);
      this.form.addControl(setting.key, control);
      next[setting.key] = control;
    }
    this.controls.set(next);
  }

  private label(setting: Setting): string {
    const key = `settings.fields.${setting.key}`;
    return this.i18n.has(key) ? this.i18n.translate(key) : setting.key;
  }
}

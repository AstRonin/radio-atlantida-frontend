import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import {
  GRAFANA_LOGS_DASHBOARD,
  RuntimeConfigService,
} from '../../core/config/runtime-config.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LOG_COMPONENTS,
  LOG_LEVELS,
  LogComponent,
  LogLevel,
  LogQuery,
  isLogComponent,
  isLogLevel,
} from '../../core/logs/log-files';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { StationTimeService } from '../../core/time/station-time.service';
import { controlVersion } from '../../shared/forms/field-errors';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { FileSizePipe } from '../../shared/ui/file-size.pipe';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

type LogEntry = ApiSchema<'LogEntry'>;

export const LOG_PAGE_SIZE = 100;
/** The API reads no further than this offset into a file. */
export const LOG_MAX_OFFSET = 100_000;

interface EntriesQuery {
  name: string;
  query: LogQuery;
}

interface PageRequest {
  request: EntriesQuery;
  offset: number;
}

interface LogRow {
  entry: LogEntry;
  /** The entry's other fields as `key: value` lines. */
  attrs: string[];
  warn: boolean;
}

/**
 * The backend's diagnostic log (design §10.1): one file per UTC day, read newest first and
 * filtered by the backend. Nothing announces new lines, so the page reads again on request. Query
 * parameters (`file`, `level`, `component`, `request`) open the log of one event, as the error
 * popup links it.
 */
@Component({
  selector: 'app-logs-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    StationTimePipe,
    FieldHintComponent,
    FileSizePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="logs.title" helpPage="help.logs">
      @if (grafanaUrl(); as grafana) {
        <a
          matButton="outlined"
          [href]="grafana + grafanaLogs"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ 'logs.openGrafana' | translate }} <span aria-hidden="true">↗</span>
          <span class="cdk-visually-hidden">{{ 'common.opensInNewTab' | translate }}</span>
        </a>
      }
    </app-page-header>

    <section class="page-section" aria-labelledby="filters-heading">
      <h2 id="filters-heading" class="section-title">{{ 'logs.filters' | translate }}</h2>
      <p class="muted">{{ 'logs.note' | translate: { zone: zone() } }}</p>
      @if (filesError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="files.reload()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      } @else if (files.hasValue() && fileList().length === 0) {
        <p class="muted">{{ 'logs.noFiles' | translate }}</p>
      }
      <form class="filters" [formGroup]="form" (ngSubmit)="refresh()">
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.file' | translate }}</mat-label>
            <mat-select formControlName="file">
              @for (file of fileList(); track file.name) {
                <mat-option [value]="file.name">
                  {{ 'logs.fileOption' | translate: { date: file.date } }} ·
                  {{ file.size_bytes | fileSize }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="file" />
        </div>
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.level' | translate }}</mat-label>
            <mat-select formControlName="level">
              <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
              @for (level of levels; track level) {
                <mat-option [value]="level">{{ 'logs.levels.' + level | translate }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="level" />
        </div>
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.component' | translate }}</mat-label>
            <mat-select formControlName="component">
              <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
              @for (component of components; track component) {
                <mat-option [value]="component">{{ component }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="component" />
        </div>
        <div class="form-actions">
          <button matButton="filled" type="submit" [disabled]="files.isLoading() || loading()">
            {{ 'logs.refresh' | translate }}
          </button>
        </div>
      </form>
    </section>

    <section class="page-section" aria-labelledby="entries-heading">
      <h2 id="entries-heading" class="section-title">
        {{ 'logs.entries' | translate }}
        @if (total(); as count) {
          <span class="muted count">
            {{ 'logs.shown' | translate: { shown: rows().length, total: count } }}
          </span>
        }
      </h2>
      @if (loading() || files.isLoading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="refresh()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <div class="table-scroll">
        <table class="entries">
          <thead>
            <tr>
              <th scope="col">{{ 'logs.columns.time' | translate }}</th>
              <th scope="col">{{ 'logs.columns.level' | translate }}</th>
              <th scope="col">{{ 'logs.columns.component' | translate }}</th>
              <th scope="col">{{ 'logs.columns.message' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              @let entry = row.entry;
              @let requested = !!request() && entry.request_id === request();
              <tr [class.requested]="requested">
                <td class="nowrap">
                  <time [attr.datetime]="entry.time">{{
                    entry.time | stationTime: 'datetime-seconds'
                  }}</time>
                </td>
                <td>
                  <span class="badge" [class.warn]="row.warn">{{ entry.level }}</span>
                </td>
                <td>{{ entry.component }}</td>
                <td class="message">
                  <div>
                    {{ entry.message }}
                    @if (requested) {
                      <span class="badge">{{ 'logs.requested' | translate }}</span>
                    }
                  </div>
                  @if (entry.error) {
                    <div class="error">{{ entry.error }}</div>
                  }
                  @if (entry.request_id) {
                    <div class="detail">
                      {{ 'logs.requestId' | translate: { id: entry.request_id } }}
                    </div>
                  }
                  @for (attr of row.attrs; track $index) {
                    <div class="detail">{{ attr }}</div>
                  }
                </td>
              </tr>
            } @empty {
              @if (!loading() && !loadError() && total() !== null) {
                <tr>
                  <td class="muted" colspan="4">{{ 'logs.empty' | translate }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      @if (canLoadMore()) {
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'common.loadMore' | translate }}
        </button>
      } @else if (offsetLimitReached()) {
        <p class="muted">{{ 'logs.offsetLimit' | translate }}</p>
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .count {
      margin-inline-start: 0.5rem;
      font: var(--mat-sys-body-medium);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: baseline;
    }

    .entries {
      width: 100%;
      border-collapse: collapse;
    }

    .entries th,
    .entries td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      vertical-align: top;
    }

    .nowrap {
      white-space: nowrap;
    }

    .message {
      overflow-wrap: anywhere;
    }

    .error {
      color: var(--mat-sys-error);
    }

    .detail {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .requested {
      background: color-mix(in srgb, var(--mat-sys-primary-container) 50%, transparent);
    }
  `,
})
export default class LogsPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);

  /** Query parameters, as the error popup's link sets them. */
  readonly file = input<string>();
  readonly level = input<string>();
  readonly component = input<string>();
  readonly request = input<string>();

  protected readonly zone = inject(StationTimeService).zone;
  protected readonly grafanaUrl = inject(RuntimeConfigService).grafanaUrl;
  protected readonly grafanaLogs = GRAFANA_LOGS_DASHBOARD;
  protected readonly levels = LOG_LEVELS;
  protected readonly components = LOG_COMPONENTS;

  protected readonly form = new FormGroup({
    file: new FormControl<string | null>(null),
    level: new FormControl<LogLevel | null>(null),
    component: new FormControl<LogComponent | null>(null),
  });
  private readonly version = controlVersion(signal(this.form));

  protected readonly files = rxResource({ stream: () => this.api.get('/api/logs/files') });
  protected readonly fileList = computed(() =>
    this.files.hasValue() ? (this.files.value().items ?? []) : [],
  );
  protected readonly filesError = computed(() =>
    this.files.status() === 'error' ? errorMessage(this.files.error(), this.i18n) : null,
  );

  /** Null until the chosen file is one the backend lists. */
  private readonly query = computed(
    (): EntriesQuery | null => {
      this.version();
      const { file, level, component } = this.form.getRawValue();
      if (!file || !this.fileList().some((item) => item.name === file)) {
        return null;
      }
      return {
        name: file,
        query: {
          limit: LOG_PAGE_SIZE,
          ...(level ? { level } : {}),
          ...(component ? { component } : {}),
        },
      };
    },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  private readonly entries = signal<readonly LogEntry[]>([]);
  protected readonly rows = computed(() => this.entries().map(rowOf));
  protected readonly total = signal<number | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  private readonly pages = new Subject<PageRequest | null>();

  protected readonly canLoadMore = computed(() => {
    const total = this.total();
    const loaded = this.entries().length;
    return total !== null && loaded < total && loaded <= LOG_MAX_OFFSET;
  });
  protected readonly offsetLimitReached = computed(() => {
    const total = this.total();
    return total !== null && this.entries().length < total && !this.canLoadMore();
  });

  constructor() {
    // The newest file is read when none is chosen, or the chosen one is no longer listed.
    effect(() => {
      const list = this.fileList();
      if (!this.files.hasValue()) {
        return;
      }
      untracked(() => {
        const control = this.form.controls.file;
        if (!list.some((item) => item.name === control.value)) {
          control.setValue(list[0]?.name ?? null);
        }
      });
    });

    this.pages
      .pipe(
        switchMap((page) => {
          if (!page) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.loadError.set(null);
          return this.api
            .get('/api/logs/files/{name}', {
              path: { name: page.request.name },
              query: { ...page.request.query, offset: page.offset },
            })
            .pipe(
              map((result) => ({ page, result, error: null as unknown })),
              catchError((error: unknown) => of({ page, result: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        this.loading.set(false);
        if (!outcome) {
          this.entries.set([]);
          this.total.set(null);
          return;
        }
        const { page, result, error } = outcome;
        if (!result) {
          this.loadError.set(errorMessage(error, this.i18n));
          // The retention job removed the file: the list drops it and the newest is read.
          if (error instanceof ApiProblem && error.status === 404) {
            this.files.reload();
          }
          return;
        }
        const items = result.items ?? [];
        this.entries.update((rows) => (page.offset > 0 ? [...rows, ...items] : items));
        this.total.set(result.total);
      });

    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((request) => this.pages.next(request ? { request, offset: 0 } : null));
  }

  ngOnInit(): void {
    // Router inputs are set before the first change detection, not in the constructor. The file
    // is checked against the list when it arrives.
    const level = this.level();
    const component = this.component();
    this.form.setValue({
      file: this.file() ?? null,
      level: isLogLevel(level) ? level : null,
      component: isLogComponent(component) ? component : null,
    });
  }

  /** Reads the file list and the first page again. */
  protected refresh(): void {
    this.files.reload();
    const request = this.query();
    if (request) {
      this.pages.next({ request, offset: 0 });
    }
  }

  protected loadMore(): void {
    const request = this.query();
    if (request && this.canLoadMore()) {
      this.pages.next({ request, offset: this.entries().length });
    }
  }
}

function rowOf(entry: LogEntry): LogRow {
  return {
    entry,
    attrs: Object.entries(entry.attrs ?? {}).map(
      ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    ),
    warn: entry.level === 'ERROR' || entry.level === 'WARN',
  };
}

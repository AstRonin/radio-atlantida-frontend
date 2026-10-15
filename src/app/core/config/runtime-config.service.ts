import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/** Served by the panel's nginx, filled from the container environment at start. */
export const RUNTIME_CONFIG_PATH = 'config.json';

/** Grafana's provisioned dashboards (backend `dev/grafana/dashboards/`, design §10.3, §10.4). */
export const GRAFANA_LOGS_DASHBOARD = '/d/radio-logs';

/**
 * Settings of the station machine that the panel needs but the backend does not own: the
 * address of the optional Grafana (docs/f13-grafana-link-plan.md). Monitoring never blocks the
 * panel, so a missing or invalid file only means "no link" and is not reported.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private requested = false;

  private readonly grafana = signal<string | null>(null);
  /** Grafana's base URL without a trailing slash, or null when monitoring is off. */
  readonly grafanaUrl = this.grafana.asReadonly();

  /** Reads the configuration once. */
  load(): void {
    if (this.requested) {
      return;
    }
    this.requested = true;
    this.http
      .get<unknown>(RUNTIME_CONFIG_PATH)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => this.grafana.set(grafanaUrlOf(config)),
        // The dev server has no config.json; production without monitoring sends an empty URL.
        error: () => this.grafana.set(null),
      });
  }
}

/** The `grafana_url` of the configuration when it is an absolute http(s) URL. */
export function grafanaUrlOf(config: unknown): string | null {
  if (typeof config !== 'object' || config === null || !('grafana_url' in config)) {
    return null;
  }
  const value = config.grafana_url;
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return url.href.replace(/\/+$/, '');
}

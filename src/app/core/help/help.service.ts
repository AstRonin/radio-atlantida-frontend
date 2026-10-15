import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';
import { DEFAULT_LANGUAGE, I18nService } from '../i18n/i18n.service';
import { HelpContent, HelpPageId, helpFileName, isHelpContent } from './help-content';

const HELP_PATH = 'assets/help';

/**
 * Static help of the admin pages (design §6.1), shipped as JSON with the release. Help follows the
 * UI language; a page without a file in that language uses the English one. Each file is fetched
 * once per language.
 */
@Injectable({ providedIn: 'root' })
export class HelpService {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);
  private readonly language$ = toObservable(this.i18n.language);
  private readonly cache = new Map<string, Observable<HelpContent | null>>();

  /** The page that the help panel shows; null while the panel is closed. */
  private readonly openPage = signal<HelpPageId | null>(null);
  readonly panelPage = this.openPage.asReadonly();

  /** The help of a page in the active language; null when no file can be read. */
  content(page: HelpPageId): Observable<HelpContent | null> {
    return this.language$.pipe(switchMap((language) => this.load(page, language)));
  }

  /** The help of the page the panel shows; undefined while loading or closed. */
  readonly panelContent: Signal<HelpContent | null | undefined> = toSignal(
    toObservable(this.openPage).pipe(
      switchMap((page) => (page ? this.content(page) : of(undefined))),
    ),
  );

  open(page: HelpPageId): void {
    this.openPage.set(page);
  }

  close(): void {
    this.openPage.set(null);
  }

  private load(page: HelpPageId, language: string): Observable<HelpContent | null> {
    const key = `${language}/${page}`;
    let file = this.cache.get(key);
    if (!file) {
      file = this.fetch(page, language).pipe(
        catchError((error: unknown) => {
          if (language === DEFAULT_LANGUAGE) {
            // Not cached, so the next opening tries again (the server may have been restarting).
            this.cache.delete(key);
            console.error(`Could not load the help for "${page}".`, error);
            return of(null);
          }
          return this.load(page, DEFAULT_LANGUAGE);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.cache.set(key, file);
    }
    return file;
  }

  private fetch(page: HelpPageId, language: string): Observable<HelpContent> {
    return this.http.get<unknown>(`${HELP_PATH}/${language}/${helpFileName(page)}`).pipe(
      map((body) => {
        if (!isHelpContent(body)) {
          throw new Error(`The help file for "${page}" (${language}) is not complete.`);
        }
        return body;
      }),
    );
  }
}

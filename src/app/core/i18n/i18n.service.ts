import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Language {
  code: string;
  name: string;
}

/** Nested translation object as stored in `assets/i18n/<lang>.json`. */
export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export type TranslationParams = Readonly<Record<string, string | number>>;

export const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'radio-atlantida.language';
const I18N_PATH = 'assets/i18n';

/**
 * Runtime translations (docs/frontend-init-plan.md 1.3). Languages are JSON files loaded over HTTP,
 * so adding a language needs no rebuild; `@angular/localize` is not used for that reason.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly fallback = signal<Readonly<Record<string, string>>>({});
  private readonly active = signal<Readonly<Record<string, string>>>({});
  private readonly reportedMissing = new Set<string>();

  readonly languages = signal<readonly Language[]>([{ code: DEFAULT_LANGUAGE, name: 'English' }]);
  readonly language = signal(DEFAULT_LANGUAGE);
  /** Locale for `Intl` formatting of dates, times, and numbers. */
  readonly locale = computed(() => this.language());

  /** Loads the language list, English, and the remembered language. Called once at startup. */
  async init(): Promise<void> {
    try {
      const languages = await firstValueFrom(
        this.http.get<Language[]>(`${I18N_PATH}/languages.json`),
      );
      if (languages.length > 0) {
        this.languages.set(languages);
      }
    } catch (error) {
      console.error('Could not load the language list.', error);
    }

    try {
      this.fallback.set(await this.load(DEFAULT_LANGUAGE));
    } catch (error) {
      console.error('Could not load the default translations.', error);
    }

    const stored = readStoredLanguage();
    await this.use(stored && this.isKnown(stored) ? stored : DEFAULT_LANGUAGE);
  }

  /** Switches the UI language. Falls back to English if the file cannot be loaded. */
  async use(code: string): Promise<void> {
    if (!this.isKnown(code)) {
      return;
    }
    if (code === DEFAULT_LANGUAGE) {
      this.active.set(this.fallback());
    } else {
      try {
        this.active.set(await this.load(code));
      } catch (error) {
        console.error(`Could not load translations for "${code}".`, error);
        return;
      }
    }
    this.language.set(code);
    this.document.documentElement.lang = code;
    storeLanguage(code);
  }

  /** Returns the text for a dotted key, falling back to English and then to the key itself. */
  translate(key: string, params?: TranslationParams): string {
    let text = this.active()[key];
    if (text === undefined) {
      this.reportMissing(key);
      text = this.fallback()[key] ?? key;
    }
    return params ? interpolate(text, params) : text;
  }

  private isKnown(code: string): boolean {
    return this.languages().some((language) => language.code === code);
  }

  private async load(code: string): Promise<Record<string, string>> {
    const tree = await firstValueFrom(this.http.get<TranslationTree>(`${I18N_PATH}/${code}.json`));
    return flatten(tree);
  }

  private reportMissing(key: string): void {
    if (!isDevMode()) {
      return;
    }
    const id = `${this.language()}:${key}`;
    if (!this.reportedMissing.has(id)) {
      this.reportedMissing.add(id);
      console.warn(`Missing translation "${key}" for language "${this.language()}".`);
    }
  }
}

export function flatten(tree: TranslationTree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[path] = value;
    } else {
      Object.assign(result, flatten(value, path));
    }
  }
  return result;
}

function interpolate(text: string, params: TranslationParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// Storage can be unavailable (private mode, blocked site data); the language then resets to English.
function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Not critical: the choice is simply not remembered.
  }
}

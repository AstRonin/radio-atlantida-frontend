import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { I18nService } from './i18n.service';

/** Loads the translations before the first render, so no raw keys flash on screen. */
export function provideI18n(): EnvironmentProviders {
  return provideAppInitializer(() => inject(I18nService).init());
}

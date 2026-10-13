import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { GlobalErrorHandler } from './core/alerts/global-error-handler';
import { provideI18n } from './core/i18n/i18n.providers';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    // Interceptors are added in Phase F2 (RFC 9457 problem mapping).
    provideHttpClient(withFetch(), withInterceptors([])),
    provideI18n(),
  ],
};

import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { GlobalErrorHandler } from './core/alerts/global-error-handler';
import { apiProblemInterceptor, apiTimeoutInterceptor } from './core/api/api.interceptors';
import { provideI18n } from './core/i18n/i18n.providers';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    // The problem interceptor wraps the timeout one, so a timeout becomes an ApiProblem too.
    provideHttpClient(
      withFetch(),
      withInterceptors([apiProblemInterceptor, apiTimeoutInterceptor]),
    ),
    provideI18n(),
  ],
};

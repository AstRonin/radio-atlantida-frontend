import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
} from '@angular/router';
import { AlertsService } from './core/alerts/alerts.service';
import { GlobalErrorHandler } from './core/alerts/global-error-handler';
import { OutageService } from './core/alerts/outage.service';
import { apiProblemInterceptor, apiTimeoutInterceptor } from './core/api/api.interceptors';
import { provideI18n } from './core/i18n/i18n.providers';
import { OperationsService } from './core/operations/operations.service';
import { RealtimeService } from './core/realtime/realtime.service';
import { SettingsService } from './core/settings/settings.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Feature chunks are fetched in the background after the first page renders, so a later
    // navigation does not wait for the network when the panel is served from a remote host.
    provideRouter(routes, withComponentInputBinding(), withPreloading(PreloadAllModules)),
    // The problem interceptor wraps the timeout one, so a timeout becomes an ApiProblem too.
    provideHttpClient(
      withFetch(),
      withInterceptors([apiProblemInterceptor, apiTimeoutInterceptor]),
    ),
    provideI18n(),
    // The services that keep live state subscribe before the socket opens, so they see the first
    // connection. Nothing here blocks the first render.
    provideEnvironmentInitializer(() => {
      inject(OperationsService);
      inject(AlertsService);
      inject(OutageService);
      inject(SettingsService).load();
      inject(RealtimeService).connect();
    }),
  ],
};

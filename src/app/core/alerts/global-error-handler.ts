import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { AlertsService } from './alerts.service';

/**
 * Last-resort handler for uncaught errors: logs them and shows them in the error popup.
 * The panel is not in the playout path, so an error here never affects the air.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);
  // An error while showing the popup must not be reported again in a loop.
  private reporting = false;

  handleError(error: unknown): void {
    console.error('Unhandled error in the panel.', error);
    if (this.reporting) {
      return;
    }
    this.reporting = true;
    try {
      // Resolved on first use: the ErrorHandler is created before the services the popup needs.
      this.injector.get(AlertsService).showPanelError(error);
    } catch (reportError) {
      console.error('Could not show the error popup.', reportError);
    } finally {
      this.reporting = false;
    }
  }
}

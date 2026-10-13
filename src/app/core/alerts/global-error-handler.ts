import { ErrorHandler, Injectable } from '@angular/core';

/**
 * Last-resort handler for uncaught errors. It only logs for now; Phase F3 adds the error popup.
 * The panel is not in the playout path, so an error here never affects the air.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error('Unhandled error in the panel.', error);
  }
}

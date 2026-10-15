import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError, timeout } from 'rxjs';
import { isHttpFailure, toApiProblem } from './api-problem';

export const API_PREFIX = '/api/';
export const API_TIMEOUT_MS = 15_000;

// Audio is streamed for the preview player and may legitimately take minutes (design §6.6).
const NO_TIMEOUT = /^\/api\/tracks\/[^/]+\/audio(?:[?#]|$)/;

/**
 * Converts every failed API request into an `ApiProblem`, so components never parse raw HTTP
 * errors. Register it before `apiTimeoutInterceptor`, so it also converts timeouts.
 */
export const apiProblemInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_PREFIX)) {
    return next(req);
  }
  return next(req).pipe(
    catchError((error: unknown) =>
      throwError(() => (isHttpFailure(error) ? toApiProblem(error) : error)),
    ),
  );
};

export const apiTimeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_PREFIX) || NO_TIMEOUT.test(req.url)) {
    return next(req);
  }
  // `each`, not `first`: the "sent" event is emitted at once, so only the gap to the response counts.
  return next(req).pipe(timeout({ each: API_TIMEOUT_MS }));
};

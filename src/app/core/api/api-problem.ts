import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { EntityRef, FieldError, ProblemCode } from './api-types';

/**
 * Codes for failures that never reached the backend's problem handler. They are not in the
 * backend's `ProblemCode` enum, so they cannot collide with it.
 */
export type ClientProblemCode = 'network_error' | 'timeout' | 'unexpected_response';

export type ApiProblemCode = ProblemCode | ClientProblemCode;

export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface ApiProblemInit {
  status: number;
  code: ApiProblemCode;
  title: string;
  detail?: string;
  errors?: readonly FieldError[];
  used_by?: readonly EntityRef[];
  request_id?: string;
}

/**
 * Every failed API request surfaces as this error (RFC 9457 problem, design §6). Field names match
 * the backend's `Problem` schema. `status` is 0 when no response arrived (network failure, timeout).
 */
export class ApiProblem extends Error {
  override readonly name = 'ApiProblem';
  readonly status: number;
  readonly code: ApiProblemCode;
  readonly title: string;
  readonly detail?: string;
  readonly errors: readonly FieldError[];
  readonly used_by: readonly EntityRef[];
  readonly request_id?: string;

  constructor(init: ApiProblemInit) {
    super(init.detail ?? init.title);
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.errors = init.errors ?? [];
    this.used_by = init.used_by ?? [];
    this.request_id = init.request_id;
  }
}

/** True for the errors the problem interceptor converts; anything else is a bug and is rethrown. */
export function isHttpFailure(error: unknown): error is HttpErrorResponse | TimeoutError {
  return error instanceof HttpErrorResponse || error instanceof TimeoutError;
}

export function toApiProblem(error: HttpErrorResponse | TimeoutError): ApiProblem {
  if (error instanceof TimeoutError) {
    return new ApiProblem({ status: 0, code: 'timeout', title: 'Request timed out' });
  }
  if (error.status === 0) {
    return new ApiProblem({ status: 0, code: 'network_error', title: 'Network error' });
  }

  const requestId = error.headers.get(REQUEST_ID_HEADER) ?? undefined;
  const body = parseBody(error.error);
  if (isProblemBody(body)) {
    return new ApiProblem({
      status: body.status,
      code: body.code,
      title: body.title,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
      errors: Array.isArray(body.errors) ? body.errors.filter(isFieldError) : [],
      used_by: Array.isArray(body.used_by) ? body.used_by.filter(isEntityRef) : [],
      request_id: typeof body.request_id === 'string' ? body.request_id : requestId,
    });
  }

  // Not a problem object: typically a proxy page (502 from nginx while the backend restarts).
  return new ApiProblem({
    status: error.status,
    code: 'unexpected_response',
    title: error.statusText || `HTTP ${error.status}`,
    request_id: requestId,
  });
}

interface ProblemBody {
  status: number;
  code: ProblemCode;
  title: string;
  detail?: unknown;
  errors?: unknown;
  used_by?: unknown;
  request_id?: unknown;
}

// Depending on the content type, HttpClient hands over the error body parsed or as text.
function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A code this build does not know yet is kept as is: the message then falls back to `detail`.
function isProblemBody(value: unknown): value is ProblemBody {
  return (
    isRecord(value) &&
    typeof value['status'] === 'number' &&
    typeof value['code'] === 'string' &&
    typeof value['title'] === 'string'
  );
}

function isFieldError(value: unknown): value is FieldError {
  return (
    isRecord(value) &&
    typeof value['field'] === 'string' &&
    typeof value['code'] === 'string' &&
    typeof value['message'] === 'string'
  );
}

function isEntityRef(value: unknown): value is EntityRef {
  return (
    isRecord(value) &&
    typeof value['kind'] === 'string' &&
    typeof value['id'] === 'number' &&
    typeof value['name'] === 'string'
  );
}

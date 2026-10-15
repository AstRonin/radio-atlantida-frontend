import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { paths } from './generated/api';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

/** Paths of the specification that define `method`. Paths in the spec already start with `/api`. */
export type ApiPath<M extends HttpMethod> = {
  [P in keyof paths]: [paths[P][M]] extends [undefined] ? never : P;
}[keyof paths];

export type ApiOperation<P extends keyof paths, M extends HttpMethod> = NonNullable<paths[P][M]>;

type PathParams<O> = O extends { parameters: { path: infer T } } ? T : never;
type QueryParams<O> = O extends { parameters: { query?: infer T } } ? Exclude<T, undefined> : never;
type RequestBody<O> = O extends { requestBody: { content: { 'application/json': infer T } } }
  ? T
  : never;

// An absent part may not be passed; a part whose fields are all optional may be left out.
type Part<K extends string, T> = [T] extends [never]
  ? Partial<Record<K, never>>
  : Partial<T> extends T
    ? Partial<Record<K, T>>
    : Record<K, T>;

export type ApiRequestOptions<O> = Part<'path', PathParams<O>> &
  Part<'query', QueryParams<O>> &
  Part<'body', RequestBody<O>>;

type OptionsArgs<O> =
  Partial<ApiRequestOptions<O>> extends ApiRequestOptions<O>
    ? [options?: ApiRequestOptions<O>]
    : [options: ApiRequestOptions<O>];

type SuccessStatus = 200 | 201 | 202 | 204;

/** The JSON body of the operation's success responses; `null` for a response without content. */
export type ApiResponse<O> = O extends { responses: infer R }
  ? {
      [S in keyof R]: S extends SuccessStatus
        ? R[S] extends { content: { 'application/json': infer T } }
          ? T
          : null
        : never;
    }[keyof R]
  : never;

type ParamValue = string | number | boolean | null | undefined;

interface UntypedOptions {
  path?: Readonly<Record<string, ParamValue>>;
  query?: Readonly<Record<string, ParamValue>>;
  body?: unknown;
}

/**
 * Typed requests on Angular `HttpClient` (docs/frontend-init-plan.md F2). Paths, parameters, bodies,
 * and responses come from the generated `paths` type, so a request the backend does not accept is
 * a compile error. Errors arrive as `ApiProblem` (see `apiProblemInterceptor`). Requests are
 * cancelled by unsubscribing, so callers tie them to the page with `takeUntilDestroyed`.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<P extends ApiPath<'get'>>(
    path: P,
    ...[options]: OptionsArgs<ApiOperation<P, 'get'>>
  ): Observable<ApiResponse<ApiOperation<P, 'get'>>> {
    return this.request('GET', path, options);
  }

  post<P extends ApiPath<'post'>>(
    path: P,
    ...[options]: OptionsArgs<ApiOperation<P, 'post'>>
  ): Observable<ApiResponse<ApiOperation<P, 'post'>>> {
    return this.request('POST', path, options);
  }

  put<P extends ApiPath<'put'>>(
    path: P,
    ...[options]: OptionsArgs<ApiOperation<P, 'put'>>
  ): Observable<ApiResponse<ApiOperation<P, 'put'>>> {
    return this.request('PUT', path, options);
  }

  delete<P extends ApiPath<'delete'>>(
    path: P,
    ...[options]: OptionsArgs<ApiOperation<P, 'delete'>>
  ): Observable<ApiResponse<ApiOperation<P, 'delete'>>> {
    return this.request('DELETE', path, options);
  }

  /**
   * The URL of a GET endpoint, for consumers that are not `HttpClient`, such as the `<audio>`
   * element of the track preview (design §6.6).
   */
  url<P extends ApiPath<'get'>>(
    path: P,
    ...[options]: OptionsArgs<ApiOperation<P, 'get'>>
  ): string {
    const untyped = options as UntypedOptions | undefined;
    const query = toParams(untyped?.query).toString();
    return query ? `${fillPath(path, untyped?.path)}?${query}` : fillPath(path, untyped?.path);
  }

  // The typed overloads above guarantee the shapes; this is the single untyped boundary.
  private request<T>(method: string, path: string, typed: unknown): Observable<T> {
    const options = typed as UntypedOptions | undefined;
    return this.http.request<T>(method, fillPath(path, options?.path), {
      body: options?.body,
      params: toParams(options?.query),
      responseType: 'json',
    });
  }
}

function fillPath(template: string, params: UntypedOptions['path']): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter "${name}" for ${template}.`);
    }
    return encodeURIComponent(String(value));
  });
}

function toParams(query: UntypedOptions['query']): HttpParams {
  let params = new HttpParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      params = params.set(name, String(value));
    }
  }
  return params;
}

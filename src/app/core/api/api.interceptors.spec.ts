import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from './api-client.service';
import { ApiProblem } from './api-problem';
import { API_TIMEOUT_MS, apiProblemInterceptor, apiTimeoutInterceptor } from './api.interceptors';
import type { Problem } from './api-types';

describe('API interceptors', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor, apiTimeoutInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /** Subscribes and returns a getter for the error the request failed with. */
  function failure<T>(request: import('rxjs').Observable<T>): () => unknown {
    let error: unknown;
    request.subscribe({ error: (e: unknown) => (error = e) });
    return () => error;
  }

  it('maps a 422 with field errors', () => {
    const error = failure(api.post('/api/playlist-types', { body: { code: 'Promo!', name: '' } }));
    const body: Problem = {
      status: 422,
      code: 'validation_failed',
      title: 'Validation failed',
      detail: 'The request has invalid fields.',
      errors: [
        { field: 'code', code: 'pattern', message: 'must match ^[a-z][a-z0-9_-]{0,62}$' },
        { field: 'name', code: 'length', message: 'must be 1 to 100 characters' },
      ],
      request_id: 'req-422',
    };
    http
      .expectOne('/api/playlist-types')
      .flush(body, { status: 422, statusText: 'Unprocessable Entity' });

    const problem = error();
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem).toMatchObject({
      status: 422,
      code: 'validation_failed',
      detail: 'The request has invalid fields.',
      errors: body.errors,
      used_by: [],
      request_id: 'req-422',
    });
  });

  it('maps a business refusal with the blocking entities', () => {
    const error = failure(api.delete('/api/playlist-types/{id}', { path: { id: 7 } }));
    http.expectOne('/api/playlist-types/7').flush(
      {
        status: 409,
        code: 'playlist_type_in_use',
        title: 'Playlist type in use',
        used_by: [
          { kind: 'playlist', id: 3, name: 'Morning jingles' },
          { kind: 'track', id: 41, name: 'Station ID' },
        ],
      } satisfies Problem,
      { status: 409, statusText: 'Conflict' },
    );

    expect(error()).toMatchObject({
      status: 409,
      code: 'playlist_type_in_use',
      used_by: [
        { kind: 'playlist', id: 3, name: 'Morning jingles' },
        { kind: 'track', id: 41, name: 'Station ID' },
      ],
    });
  });

  it('keeps the request ID of a 500, from the body or else from the header', () => {
    const fromBody = failure(api.get('/api/settings'));
    http.expectOne('/api/settings').flush(
      { status: 500, code: 'internal_error', title: 'Internal error', request_id: 'req-body' },
      {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'X-Request-Id': 'req-header' },
      },
    );
    expect(fromBody()).toMatchObject({
      status: 500,
      code: 'internal_error',
      request_id: 'req-body',
    });

    const fromHeader = failure(api.get('/api/settings'));
    http.expectOne('/api/settings').flush(
      { status: 500, code: 'internal_error', title: 'Internal error' },
      {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'X-Request-Id': 'req-header' },
      },
    );
    expect(fromHeader()).toMatchObject({ request_id: 'req-header' });
  });

  it('parses a problem body delivered as text', () => {
    const error = failure(api.get('/api/tracks/{id}', { path: { id: 5 } }));
    http
      .expectOne('/api/tracks/5')
      .flush(JSON.stringify({ status: 404, code: 'track_not_found', title: 'Track not found' }), {
        status: 404,
        statusText: 'Not Found',
      });
    expect(error()).toMatchObject({ status: 404, code: 'track_not_found' });
  });

  it('maps a network failure', () => {
    const error = failure(api.get('/api/settings'));
    http.expectOne('/api/settings').error(new ProgressEvent('error'));
    expect(error()).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('maps a response that is not a problem object', () => {
    const error = failure(api.get('/api/settings'));
    http
      .expectOne('/api/settings')
      .flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    expect(error()).toMatchObject({
      status: 502,
      code: 'unexpected_response',
      title: 'Bad Gateway',
    });
  });

  it('times out after 15 seconds and cancels the request', () => {
    vi.useFakeTimers();
    const error = failure(api.get('/api/settings'));
    const req = http.expectOne('/api/settings');

    vi.advanceTimersByTime(API_TIMEOUT_MS - 1);
    expect(error()).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(error()).toMatchObject({ status: 0, code: 'timeout' });
    expect(req.cancelled).toBe(true);
  });

  it('applies no timeout to the track audio stream', () => {
    vi.useFakeTimers();
    const client = TestBed.inject(HttpClient);
    let done = false;
    client
      .get('/api/tracks/5/audio', { responseType: 'blob' })
      .subscribe({ next: () => (done = true) });
    const req = http.expectOne('/api/tracks/5/audio');

    vi.advanceTimersByTime(API_TIMEOUT_MS * 10);
    expect(req.cancelled).toBe(false);
    req.flush(new Blob());
    expect(done).toBe(true);
  });

  it('leaves requests outside /api untouched', () => {
    const client = TestBed.inject(HttpClient);
    const error = failure(client.get('assets/i18n/xx.json'));
    http.expectOne('assets/i18n/xx.json').flush('', { status: 404, statusText: 'Not Found' });
    expect(error()).not.toBeInstanceOf(ApiProblem);
  });
});

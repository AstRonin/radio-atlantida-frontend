import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client.service';
import type { ApiSchema } from './api-types';

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('fills path parameters and sends the body', () => {
    let result: ApiSchema<'PlaylistType'> | undefined;
    api
      .put('/api/playlist-types/{id}', { path: { id: 4 }, body: { name: 'Promos' } })
      .subscribe((type) => (result = type));

    const req = http.expectOne('/api/playlist-types/4');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Promos' });
    const type: ApiSchema<'PlaylistType'> = {
      id: 4,
      code: 'promo',
      name: 'Promos',
      is_system: false,
      playlist_count: 0,
      track_count: 0,
      created_at: '2026-10-13T08:00:00Z',
    };
    req.flush(type);
    expect(result).toEqual(type);
  });

  it('sends only the query parameters that are set', () => {
    api
      .get('/api/tracks', { query: { q: 'rain & snow', type_id: 2, cursor: undefined } })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/tracks');
    expect(req.request.params.keys()).toEqual(['q', 'type_id']);
    expect(req.request.urlWithParams).toBe('/api/tracks?q=rain%20%26%20snow&type_id=2');
    req.flush({ items: [] });
  });

  it('encodes path parameters', () => {
    api.get('/api/logs/files/{name}', { path: { name: 'app 1/2.log' } }).subscribe();
    http.expectOne('/api/logs/files/app%201%2F2.log').flush({ items: [] });
  });

  it('completes a 204 delete without a body', () => {
    let completed = false;
    api
      .delete('/api/artists/{id}', { path: { id: 9 } })
      .subscribe({ complete: () => (completed = true) });
    const req = http.expectOne('/api/artists/9');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });

  it('builds URLs for consumers outside HttpClient', () => {
    expect(api.url('/api/tracks/{id}/audio', { path: { id: 12 } })).toBe('/api/tracks/12/audio');
    expect(api.url('/api/playlists', { query: { type_id: 3 } })).toBe('/api/playlists?type_id=3');
  });

  it('rejects requests that do not match the specification at compile time', () => {
    // Each line below must fail to compile; `npm run typecheck` fails if one starts compiling.
    // The calls are never subscribed, so nothing is sent.
    const checks: (() => Observable<unknown> | string)[] = [
      // @ts-expect-error unknown path
      () => api.get('/api/no-such-path'),
      // @ts-expect-error the path has no POST
      () => api.post('/api/settings/secrets', { body: {} }),
      // @ts-expect-error path parameters are required
      () => api.get('/api/tracks/{id}'),
      // @ts-expect-error path parameter of the wrong type
      () => api.get('/api/tracks/{id}', { path: { id: 'five' } }),
      // @ts-expect-error unknown query parameter
      () => api.get('/api/tracks', { query: { title: 'x' } }),
      // @ts-expect-error the body is required
      () => api.post('/api/playlist-types'),
      // @ts-expect-error the body misses a required field
      () => api.post('/api/playlist-types', { body: { name: 'Promos' } }),
      // @ts-expect-error a GET takes no body
      () => api.get('/api/settings', { body: {} }),
    ];
    expect(checks.length).toBeGreaterThan(0);

    // And the response type comes from the same definition.
    const tracks: Observable<ApiSchema<'TrackPage'>> = api.get('/api/tracks');
    expect(tracks).toBeInstanceOf(Observable);
  });
});

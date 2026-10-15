import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiClient, ApiOperation } from '../api/api-client.service';
import { ApiProblem } from '../api/api-problem';
import type { ApiSchema } from '../api/api-types';
import { problemMessage } from '../api/problem-message';
import { I18nService } from '../i18n/i18n.service';

export type TrackQuery = NonNullable<ApiOperation<'/api/tracks', 'get'>['parameters']['query']>;

/**
 * Read-only lists that the shared selects and pickers offer: playlist types, playlists, play
 * rules, artists, tracks, and clocks. The pickers stay free of HTTP, and each list is read when a picker
 * opens, so a type or playlist added a moment ago is offered at once (design §6.2). Callers
 * unsubscribe on destroy, which cancels the request.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly api = inject(ApiClient);

  playlistTypes(): Observable<ApiSchema<'PlaylistType'>[]> {
    return this.api.get('/api/playlist-types').pipe(map((list) => list.items));
  }

  playlists(): Observable<ApiSchema<'Playlist'>[]> {
    return this.api.get('/api/playlists').pipe(map((list) => list.items));
  }

  playRules(): Observable<ApiSchema<'PlayRule'>[]> {
    return this.api.get('/api/play-rules').pipe(map((list) => list.items));
  }

  artists(search?: string): Observable<ApiSchema<'Artist'>[]> {
    return this.api
      .get('/api/artists', { query: { q: search || undefined } })
      .pipe(map((list) => list.items));
  }

  tracks(query: TrackQuery): Observable<ApiSchema<'TrackPage'>> {
    return this.api.get('/api/tracks', { query });
  }

  clocks(): Observable<ApiSchema<'ClockSummary'>[]> {
    return this.api.get('/api/clocks').pipe(map((list) => list.items));
  }

  track(id: number): Observable<ApiSchema<'Track'>> {
    return this.api.get('/api/tracks/{id}', { path: { id } });
  }
}

export interface CatalogList<T> {
  status: 'loading' | 'ready' | 'error';
  items: readonly T[];
  /** The message of a failed read, already translated. */
  error?: string;
}

/**
 * A list read once as a signal, for the selects and pickers. A failed read becomes a message in
 * the state instead of an error thrown from the template. Call in an injection context; leaving
 * the page cancels the request.
 */
export function catalogList<T>(source: Observable<readonly T[]>): Signal<CatalogList<T>> {
  const i18n = inject(I18nService);
  return toSignal(
    source.pipe(
      map((items): CatalogList<T> => ({ status: 'ready', items })),
      catchError((error: unknown) =>
        of<CatalogList<T>>({
          status: 'error',
          items: [],
          error:
            error instanceof ApiProblem
              ? problemMessage(error, i18n)
              : i18n.translate('alerts.panelError'),
        }),
      ),
    ),
    { initialValue: { status: 'loading', items: [] } },
  );
}

import { Injectable } from '@angular/core';
import type { TrackQuery } from '../../core/catalog/catalog.service';

/**
 * The list as the library page last read it: the query (filters, order, and paging), the total,
 * and the IDs of the rows in list order. The track editor's Save and Next takes the next track
 * from here, so it follows the list the operator sees.
 */
export interface LibraryCursor {
  query: TrackQuery;
  offset: number;
  size: number;
  total: number;
  trackIds: readonly number[];
}

/**
 * Kept in memory, not in the URL: the search and the playlist and type filters are not in the
 * URL. A reload of the browser leaves no cursor, so Save and Next then has no next track.
 */
@Injectable({ providedIn: 'root' })
export class LibraryCursorService {
  private cursor: LibraryCursor | null = null;

  current(): LibraryCursor | null {
    return this.cursor;
  }

  set(cursor: LibraryCursor): void {
    this.cursor = cursor;
  }
}

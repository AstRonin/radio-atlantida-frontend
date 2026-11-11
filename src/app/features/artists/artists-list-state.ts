import { Params } from '@angular/router';
import type { ArtistQuery } from '../../core/catalog/catalog.service';

export type ArtistSort = NonNullable<ArtistQuery['sort']>;
export type ArtistOrder = NonNullable<ArtistQuery['order']>;

export const ARTISTS_PAGE_SIZES: readonly number[] = [25, 50, 100, 200];
export const ARTISTS_DEFAULT_PAGE_SIZE = 50;

// Records, so a sort key added to or removed from the spec's enum is a compile error here.
const SORTS: Record<ArtistSort, true> = { name: true, track_count: true };
const ORDERS: Record<ArtistOrder, true> = { asc: true, desc: true };

/** Where the manager is in the artist list: the page (0-based), its size, and the order. */
export interface ArtistsListState {
  pageIndex: number;
  pageSize: number;
  sort: ArtistSort;
  order: ArtistOrder;
}

export const DEFAULT_ARTISTS_LIST_STATE: ArtistsListState = {
  pageIndex: 0,
  pageSize: ARTISTS_DEFAULT_PAGE_SIZE,
  sort: 'name',
  order: 'asc',
};

/** The query parameters of `/artists` as the router passes them to the page. */
export interface ArtistsListParams {
  page?: string;
  size?: string;
  sort?: string;
  order?: string;
}

export function isArtistSort(value: unknown): value is ArtistSort {
  return typeof value === 'string' && Object.hasOwn(SORTS, value);
}

function isArtistOrder(value: unknown): value is ArtistOrder {
  return typeof value === 'string' && Object.hasOwn(ORDERS, value);
}

/** Reads the state from the URL; a value not allowed falls back to its default, alone. */
export function readArtistsListState(params: ArtistsListParams): ArtistsListState {
  const page = Number(params.page);
  const size = Number(params.size);
  return {
    pageIndex: /^\d+$/.test(params.page ?? '') && page >= 1 ? page - 1 : 0,
    pageSize: ARTISTS_PAGE_SIZES.includes(size) ? size : DEFAULT_ARTISTS_LIST_STATE.pageSize,
    sort: isArtistSort(params.sort) ? params.sort : DEFAULT_ARTISTS_LIST_STATE.sort,
    order: isArtistOrder(params.order) ? params.order : DEFAULT_ARTISTS_LIST_STATE.order,
  };
}

/**
 * The query parameters for the state, to merge into the URL. A default is `null`, which removes
 * the parameter, so the plain `/artists` stays the default view.
 */
export function artistsListStateParams(state: ArtistsListState): Params {
  const or = <T>(value: T, fallback: T): T | null => (value === fallback ? null : value);
  const defaults = DEFAULT_ARTISTS_LIST_STATE;
  return {
    page: state.pageIndex === defaults.pageIndex ? null : state.pageIndex + 1,
    size: or(state.pageSize, defaults.pageSize),
    sort: or(state.sort, defaults.sort),
    order: or(state.order, defaults.order),
  };
}

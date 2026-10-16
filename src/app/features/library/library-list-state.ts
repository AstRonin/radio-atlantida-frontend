import { Params } from '@angular/router';
import type { TrackQuery } from '../../core/catalog/catalog.service';

export type TrackSort = NonNullable<TrackQuery['sort']>;
export type SortOrder = NonNullable<TrackQuery['order']>;
export type ReviewedFilter = NonNullable<TrackQuery['reviewed']>;
export type InPlanFilter = NonNullable<TrackQuery['in_plan']>;

export const LIBRARY_PAGE_SIZES: readonly number[] = [25, 50, 100, 200];
export const LIBRARY_DEFAULT_PAGE_SIZE = 50;

// Records, so a sort key added to or removed from the spec's enum is a compile error here.
const SORTS: Record<TrackSort, true> = {
  title: true,
  artist: true,
  type: true,
  duration: true,
  format: true,
  quality: true,
  reviewed: true,
  next_planned_at: true,
};
const ORDERS: Record<SortOrder, true> = { asc: true, desc: true };
const REVIEWED: Record<ReviewedFilter, true> = { true: true, false: true };
const IN_PLAN: Record<InPlanFilter, true> = { true: true, false: true };

/** Where the manager is in the library list: the page (0-based), its size, and the order. */
export interface LibraryListState {
  pageIndex: number;
  pageSize: number;
  sort: TrackSort;
  order: SortOrder;
}

export const DEFAULT_LIST_STATE: LibraryListState = {
  pageIndex: 0,
  pageSize: LIBRARY_DEFAULT_PAGE_SIZE,
  sort: 'title',
  order: 'asc',
};

/** The query parameters of `/library` as the router passes them to the page. */
export interface LibraryListParams {
  page?: string;
  size?: string;
  sort?: string;
  order?: string;
}

export function isTrackSort(value: unknown): value is TrackSort {
  return typeof value === 'string' && Object.hasOwn(SORTS, value);
}

function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === 'string' && Object.hasOwn(ORDERS, value);
}

/** The `reviewed` filter from the URL; any other value means all tracks. */
export function readReviewedFilter(value: string | undefined): ReviewedFilter | null {
  return value !== undefined && Object.hasOwn(REVIEWED, value) ? (value as ReviewedFilter) : null;
}

/** The `in_plan` filter from the URL; any other value means all tracks. */
export function readInPlanFilter(value: string | undefined): InPlanFilter | null {
  return value !== undefined && Object.hasOwn(IN_PLAN, value) ? (value as InPlanFilter) : null;
}

/**
 * Whether the URL asks for tracks without a playlist (`in_playlist=false`). The panel offers only
 * that side of the filter: tracks in a playlist are found by the playlist filter.
 */
export function readWithoutPlaylist(value: string | undefined): boolean {
  return value === 'false';
}

/** Reads the state from the URL; a value not allowed falls back to its default, alone. */
export function readListState(params: LibraryListParams): LibraryListState {
  const page = Number(params.page);
  const size = Number(params.size);
  return {
    pageIndex: /^\d+$/.test(params.page ?? '') && page >= 1 ? page - 1 : 0,
    pageSize: LIBRARY_PAGE_SIZES.includes(size) ? size : DEFAULT_LIST_STATE.pageSize,
    sort: isTrackSort(params.sort) ? params.sort : DEFAULT_LIST_STATE.sort,
    order: isSortOrder(params.order) ? params.order : DEFAULT_LIST_STATE.order,
  };
}

/**
 * The query parameters for the state, to merge into the URL. A default is `null`, which removes
 * the parameter, so the plain `/library` stays the default view.
 */
export function listStateParams(state: LibraryListState): Params {
  const or = <T>(value: T, fallback: T): T | null => (value === fallback ? null : value);
  return {
    page: state.pageIndex === DEFAULT_LIST_STATE.pageIndex ? null : state.pageIndex + 1,
    size: or(state.pageSize, DEFAULT_LIST_STATE.pageSize),
    sort: or(state.sort, DEFAULT_LIST_STATE.sort),
    order: or(state.order, DEFAULT_LIST_STATE.order),
  };
}

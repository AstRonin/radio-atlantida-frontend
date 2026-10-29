import type { Params } from '@angular/router';
import {
  LOG_SEARCH_MAX_LENGTH,
  LogComponent,
  LogLevel,
  LogsQueryParams,
  REQUEST_ID_PATTERN,
  apiInstant,
  isLogComponent,
  isLogLevel,
  parseInstant,
} from '../../core/logs/log-query';

const HOUR_MS = 60 * 60 * 1000;

/** The time-range presets, as the length of the range that ends now. */
export const RANGE_PRESETS = {
  hour: HOUR_MS,
  '6h': 6 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
} as const;

export type RangePreset = keyof typeof RANGE_PRESETS;

export const RANGE_PRESET_IDS = Object.keys(RANGE_PRESETS) as readonly RangePreset[];
export const DEFAULT_RANGE: RangePreset = '6h';

/** `window` is the range of an error popup's link; the choice is listed only while it is set. */
export type RangeChoice = RangePreset | 'window';

/** A range as UTC instants in the API's form. */
export interface LogSpan {
  from: string;
  to: string;
}

/** The filters the list shows. Text filters are applied with the rest, on Refresh. */
export interface LogsState {
  range: RangeChoice;
  /** The linked range; set only when `range` is `window`. */
  span: LogSpan | null;
  level: LogLevel | null;
  component: LogComponent | null;
  search: string | null;
  requestId: string | null;
}

/** The logs page's query parameters, named as the links and the URL use them. */
export interface LogsParams {
  range?: string;
  from?: string;
  to?: string;
  level?: string;
  component?: string;
  search?: string;
  request?: string;
}

/** The request of one page of entries, without the paging parameters. */
export type LogsRequest = Pick<
  LogsQueryParams,
  'from' | 'to' | 'level' | 'component' | 'search' | 'request_id'
>;

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === 'string' && Object.hasOwn(RANGE_PRESETS, value);
}

/**
 * Reads the page state from its parameters. A value the page does not accept is ignored, so a
 * link with an unknown filter still opens the page. A link with both `from` and `to` (the error
 * popup's link) opens that span; otherwise the range preset applies.
 */
export function stateFromParams(params: LogsParams): LogsState {
  const from = parseInstant(params.from);
  const to = parseInstant(params.to);
  const span =
    from !== null && to !== null && Date.parse(from) < Date.parse(to) ? { from, to } : null;
  const search = params.search;
  const request = params.request;
  return {
    range: span ? 'window' : isRangePreset(params.range) ? params.range : DEFAULT_RANGE,
    span,
    level: isLogLevel(params.level) ? params.level : null,
    component: isLogComponent(params.component) ? params.component : null,
    search:
      search !== undefined && search !== '' && search.length <= LOG_SEARCH_MAX_LENGTH
        ? search
        : null,
    requestId: request !== undefined && REQUEST_ID_PATTERN.test(request) ? request : null,
  };
}

/** The parameters that restore a state; a filter at its default is left out. */
export function paramsFromState(state: LogsState): Params {
  const span = state.range === 'window' ? state.span : null;
  return {
    ...(span ? { from: span.from, to: span.to } : { range: presetOf(state.range) }),
    ...(state.level ? { level: state.level } : {}),
    ...(state.component ? { component: state.component } : {}),
    ...(state.search ? { search: state.search } : {}),
    ...(state.requestId ? { request: state.requestId } : {}),
  };
}

/** The request for the first page: a preset range ends now, a linked span is kept. */
export function requestFor(state: LogsState, now: Date): LogsRequest {
  const span =
    state.range === 'window' && state.span
      ? state.span
      : {
          from: apiInstant(now.getTime() - RANGE_PRESETS[presetOf(state.range)]),
          to: apiInstant(now.getTime()),
        };
  return {
    ...span,
    ...(state.level ? { level: state.level } : {}),
    ...(state.component ? { component: state.component } : {}),
    ...(state.search ? { search: state.search } : {}),
    ...(state.requestId ? { request_id: state.requestId } : {}),
  };
}

/** A key that is equal for equal states, so the page can tell a state it wrote from a new one. */
export function stateKey(state: LogsState): string {
  return JSON.stringify(state);
}

function presetOf(range: RangeChoice): RangePreset {
  return isRangePreset(range) ? range : DEFAULT_RANGE;
}

import { paramsFromState, requestFor, stateFromParams, stateKey } from './log-state';

describe('log page state', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('defaults to the last 6 hours with no filters', () => {
    const state = stateFromParams({});
    expect(state.range).toBe('6h');
    expect(requestFor(state, now)).toEqual({
      from: '2026-10-15T06:00:00Z',
      to: '2026-10-15T12:00:00Z',
    });
  });

  it('ends a preset range now, for each preset', () => {
    expect(requestFor(stateFromParams({ range: 'hour' }), now).from).toBe('2026-10-15T11:00:00Z');
    expect(requestFor(stateFromParams({ range: '24h' }), now).from).toBe('2026-10-14T12:00:00Z');
    expect(requestFor(stateFromParams({ range: '7d' }), now).from).toBe('2026-10-08T12:00:00Z');
  });

  it('ignores a range it does not know', () => {
    expect(stateFromParams({ range: '90d' }).range).toBe('6h');
  });

  it('keeps a linked span over the range preset', () => {
    const state = stateFromParams({
      range: '24h',
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
    });
    expect(state.range).toBe('window');
    expect(requestFor(state, now)).toEqual({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
    });
  });

  it('ignores a span that ends before it starts', () => {
    const state = stateFromParams({ from: '2026-10-15T09:00:00Z', to: '2026-10-15T08:00:00Z' });
    expect(state.range).toBe('6h');
    expect(state.span).toBeNull();
  });

  it('ignores filters that are not allowed', () => {
    const state = stateFromParams({
      level: 'loud',
      component: 'network',
      search: '',
      request: 'a b',
    });
    expect(state.level).toBeNull();
    expect(state.component).toBeNull();
    expect(state.search).toBeNull();
    expect(state.requestId).toBeNull();
  });

  it('sends the filters that are set', () => {
    const state = stateFromParams({
      range: '24h',
      level: 'WARN',
      component: 'icecast',
      search: 'timeout',
      request: 'r-7',
    });
    expect(requestFor(state, now)).toEqual({
      from: '2026-10-14T12:00:00Z',
      to: '2026-10-15T12:00:00Z',
      level: 'WARN',
      component: 'icecast',
      search: 'timeout',
      request_id: 'r-7',
    });
  });

  it('writes a state as URL parameters that restore it', () => {
    const state = stateFromParams({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
      component: 'icecast',
      request: 'r-7',
    });
    const params = paramsFromState(state);
    expect(params).toEqual({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
      component: 'icecast',
      request: 'r-7',
    });
    expect(stateKey(stateFromParams(params))).toBe(stateKey(state));
  });

  it('writes a preset as its name, without the span', () => {
    expect(paramsFromState(stateFromParams({ range: '24h' }))).toEqual({ range: '24h' });
    expect(paramsFromState(stateFromParams({ range: '7d', search: 'x' }))).toEqual({
      range: '7d',
      search: 'x',
    });
  });
});

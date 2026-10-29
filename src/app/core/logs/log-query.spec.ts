import {
  REQUEST_ID_PATTERN,
  apiInstant,
  isLogComponent,
  isLogLevel,
  logLink,
  parseInstant,
} from './log-query';

describe('log query', () => {
  it('links an error to the log of 15 minutes either side of it', () => {
    expect(
      logLink({ time: '2026-10-15T08:00:00Z', component: 'liquidsoap', requestId: 'r-1' }),
    ).toEqual({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
      component: 'liquidsoap',
      request: 'r-1',
    });
  });

  it('leaves out a component the log does not know', () => {
    expect(logLink({ time: '2026-10-15T08:00:00Z', component: 'network' })).toEqual({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
    });
  });

  it('writes instants in the API form, with whole seconds', () => {
    expect(apiInstant(Date.parse('2026-10-15T08:00:00.250Z'))).toBe('2026-10-15T08:00:00Z');
    expect(parseInstant('2026-10-15T08:00:00+04:00')).toBe('2026-10-15T04:00:00Z');
    expect(parseInstant('yesterday')).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
  });

  it('accepts only the API values', () => {
    expect(isLogLevel('WARN')).toBe(true);
    expect(isLogLevel('warn')).toBe(false);
    expect(isLogComponent('media')).toBe(true);
    expect(isLogComponent('backend')).toBe(false);
  });

  it('accepts the request IDs the backend accepts', () => {
    expect(REQUEST_ID_PATTERN.test('req-1_A.b/c+d=e')).toBe(true);
    expect(REQUEST_ID_PATTERN.test('a b')).toBe(false);
    expect(REQUEST_ID_PATTERN.test('a"b')).toBe(false);
    expect(REQUEST_ID_PATTERN.test('')).toBe(false);
    expect(REQUEST_ID_PATTERN.test('x'.repeat(201))).toBe(false);
  });
});

import { isLogComponent, isLogLevel, logFileName, logLink } from './log-files';

describe('log files', () => {
  it('names the file by the UTC date, not the station date', () => {
    // 22:00 UTC on the 14th is already the 15th in Yerevan.
    expect(logFileName('2026-10-14T22:00:00Z')).toBe('app-2026-10-14.log');
  });

  it('links an event to its file, component, and request', () => {
    expect(
      logLink({ time: '2026-10-15T08:00:00Z', component: 'liquidsoap', requestId: 'r-1' }),
    ).toEqual({ file: 'app-2026-10-15.log', component: 'liquidsoap', request: 'r-1' });
  });

  it('leaves out a component the log does not know', () => {
    expect(logLink({ time: '2026-10-15T08:00:00Z', component: 'network' })).toEqual({
      file: 'app-2026-10-15.log',
    });
  });

  it('accepts only the API values', () => {
    expect(isLogLevel('WARN')).toBe(true);
    expect(isLogLevel('warn')).toBe(false);
    expect(isLogComponent('media')).toBe(true);
    expect(isLogComponent('backend')).toBe(false);
  });
});

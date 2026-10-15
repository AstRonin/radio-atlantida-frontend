import { formatFileSize } from './file-size.pipe';

describe('formatFileSize', () => {
  it('formats file sizes in the largest fitting unit', () => {
    expect(formatFileSize(900, 'en')).toBe('900 B');
    expect(formatFileSize(1536, 'en')).toBe('1.5 KB');
    expect(formatFileSize(5_242_880, 'en')).toBe('5 MB');
    expect(formatFileSize(12_884_901_888, 'en')).toBe('12 GB');
  });
});

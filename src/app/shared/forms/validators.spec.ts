import { FormControl, FormGroup } from '@angular/forms';
import {
  atLeastOneValidator,
  bothOrNoneValidator,
  dateRangeValidator,
  rangeValidator,
  relativePathValidator,
  timeOfDayValidator,
  weekdaysValidator,
} from './validators';

describe('validators', () => {
  describe('rangeValidator', () => {
    const validate = (value: unknown) =>
      rangeValidator({ min: 1, max: 3600, step: 1 })(new FormControl(value));

    it('accepts values in range and empty values', () => {
      expect(validate(1)).toBeNull();
      expect(validate(3600)).toBeNull();
      expect(validate(null)).toBeNull();
      expect(validate('')).toBeNull();
    });

    it('refuses values out of range with the limits', () => {
      expect(validate(0)).toEqual({ range: { min: 1, max: 3600, step: 1 } });
      expect(validate(3601)).toEqual({ range: { min: 1, max: 3600, step: 1 } });
      expect(validate('abc')).toEqual({ range: { min: 1, max: 3600, step: 1 } });
    });

    it('refuses values off the step, counted from min', () => {
      expect(validate(1.5)).toEqual({ step: { min: 1, max: 3600, step: 1 } });
      const gain = rangeValidator({ min: 0, max: 1, step: 0.1 });
      expect(gain(new FormControl(0.3))).toBeNull();
      expect(gain(new FormControl(0.35))).not.toBeNull();
    });
  });

  it('timeOfDayValidator accepts HH:MM from 00:00 to 23:59 only', () => {
    const validate = (value: unknown) => timeOfDayValidator(new FormControl(value));
    expect(validate('06:00')).toBeNull();
    expect(validate('23:59')).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate('24:00')).toEqual({ timeOfDay: true });
    expect(validate('6:00')).toEqual({ timeOfDay: true });
    expect(validate('06:00:00')).toEqual({ timeOfDay: true });
  });

  it('weekdaysValidator accepts a set of 1 to 7', () => {
    const validate = (value: unknown) => weekdaysValidator(new FormControl(value));
    expect(validate([1, 3, 7])).toBeNull();
    expect(validate([])).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate([0])).toEqual({ weekdays: true });
    expect(validate([8])).toEqual({ weekdays: true });
    expect(validate([2, 2])).toEqual({ weekdays: true });
    expect(validate([1.5])).toEqual({ weekdays: true });
  });

  describe('bothOrNoneValidator', () => {
    const window = (from: string | null, to: string | null) =>
      new FormGroup(
        { window_from: new FormControl(from), window_to: new FormControl(to) },
        { validators: bothOrNoneValidator(['window_from', 'window_to']) },
      );

    it('accepts both or none', () => {
      expect(window('06:00', '08:00').valid).toBe(true);
      expect(window(null, null).valid).toBe(true);
    });

    it('marks the group and the empty field when only one is set', () => {
      const form = window('06:00', null);
      expect(form.hasError('bothOrNone')).toBe(true);
      expect(form.controls.window_to.hasError('bothOrNone')).toBe(true);
      expect(form.controls.window_from.hasError('bothOrNone')).toBe(false);

      form.controls.window_to.setValue('08:00');
      expect(form.valid).toBe(true);
      expect(form.controls.window_to.errors).toBeNull();
    });

    it('keeps the field’s own errors', () => {
      const form = window('06:00', null);
      form.controls.window_to.setErrors({ server: true, bothOrNone: true });
      form.controls.window_from.setValue(null);
      expect(form.controls.window_to.errors).toEqual({ server: true });
    });
  });

  it('atLeastOneValidator needs one of the fields', () => {
    const form = new FormGroup(
      {
        window_from: new FormControl<string | null>(null),
        min_interval_minutes: new FormControl<number | null>(null),
        max_per_hour: new FormControl<number | null>(null),
      },
      {
        validators: atLeastOneValidator(['window_from', 'min_interval_minutes', 'max_per_hour']),
      },
    );
    expect(form.errors).toEqual({
      atLeastOne: { fields: ['window_from', 'min_interval_minutes', 'max_per_hour'] },
    });
    form.controls.max_per_hour.setValue(1);
    expect(form.valid).toBe(true);
  });

  describe('relativePathValidator', () => {
    const validate = (value: unknown) => relativePathValidator(new FormControl(value));

    it('accepts paths under the media root and empty values', () => {
      expect(validate('music/song.mp3')).toBeNull();
      expect(validate('jingles/2026/id..final.mp3')).toBeNull();
      expect(validate('')).toBeNull();
      expect(validate(null)).toBeNull();
    });

    it('refuses absolute paths, backslashes, and parent elements', () => {
      for (const path of [
        '/media/song.mp3',
        'C:/media/song.mp3',
        'c:song.mp3',
        'music\\song.mp3',
        '../song.mp3',
        'music/../../etc/passwd',
        'music/..',
      ]) {
        expect(validate(path), path).toEqual({ relativePath: true });
      }
    });
  });

  describe('dateRangeValidator', () => {
    const group = (from: string | null, to: string | null) =>
      new FormGroup(
        { from: new FormControl(from), to: new FormControl(to) },
        { validators: dateRangeValidator('from', 'to', 7) },
      );

    it('accepts 1 to 7 days and leaves empty fields to required', () => {
      expect(group('2026-10-15', '2026-10-15').valid).toBe(true);
      expect(group('2026-10-15', '2026-10-21').valid).toBe(true);
      expect(group('2026-10-15', null).valid).toBe(true);
    });

    it('marks the last date when the range is reversed or too long', () => {
      for (const to of ['2026-10-14', '2026-10-22']) {
        const form = group('2026-10-15', to);
        expect(form.errors, to).toEqual({ dateRange: { maxDays: 7 } });
        expect(form.controls.to.getError('dateRange'), to).toEqual({ maxDays: 7 });
      }
    });

    it('clears the mark once the range is fixed', () => {
      const form = group('2026-10-15', '2026-10-22');
      form.controls.to.setValue('2026-10-16');
      expect(form.valid).toBe(true);
      expect(form.controls.to.errors).toBeNull();
    });
  });
});

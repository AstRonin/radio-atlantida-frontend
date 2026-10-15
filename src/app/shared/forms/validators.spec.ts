import { FormControl, FormGroup } from '@angular/forms';
import {
  atLeastOneValidator,
  bothOrNoneValidator,
  rangeValidator,
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
});

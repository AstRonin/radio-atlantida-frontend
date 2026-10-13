import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { SERVER_ERROR, applyServerErrors, controlPath } from './server-errors';

describe('server errors on forms', () => {
  function clockForm(): FormGroup {
    return new FormGroup({
      name: new FormControl('Morning', { validators: Validators.required }),
      elements: new FormArray(
        [0, 1, 2].map(() => new FormGroup({ fixed_minute: new FormControl(0) })),
      ),
    });
  }

  it('parses field paths', () => {
    expect(controlPath('name')).toEqual(['name']);
    expect(controlPath('elements[2].fixed_minute')).toEqual(['elements', 2, 'fixed_minute']);
    expect(controlPath('grid[1][3]')).toEqual(['grid', 1, 3]);
    expect(controlPath('query.limit')).toBeNull();
    expect(controlPath('path.id')).toBeNull();
    expect(controlPath('a..b')).toBeNull();
  });

  it('puts each error on its control and returns the rest', () => {
    const form = clockForm();
    const unmatched = applyServerErrors(form, [
      { field: 'elements[2].fixed_minute', code: 'range', message: 'must be 0 to 59' },
      { field: 'name', code: 'taken', message: 'name is taken' },
      { field: 'query.limit', code: 'range', message: 'too large' },
      { field: 'elements[9].fixed_minute', code: 'range', message: 'no such element' },
    ]);

    const minute = form.get(['elements', 2, 'fixed_minute']);
    expect(minute?.errors).toEqual({
      [SERVER_ERROR]: { code: 'range', message: 'must be 0 to 59' },
    });
    expect(minute?.touched).toBe(true);
    expect(form.get('name')?.hasError(SERVER_ERROR)).toBe(true);
    expect(form.valid).toBe(false);
    expect(unmatched.map((e) => e.field)).toEqual(['query.limit', 'elements[9].fixed_minute']);
  });

  it('keeps client errors and clears the server error on the next edit', () => {
    const form = clockForm();
    const name = form.get('name');
    name?.setValue('');
    applyServerErrors(form, [{ field: 'name', code: 'required', message: 'required' }]);
    expect(name?.hasError('required')).toBe(true);
    expect(name?.hasError(SERVER_ERROR)).toBe(true);

    name?.setValue('Evening');
    expect(name?.errors).toBeNull();
  });
});

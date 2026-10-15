import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { I18nService } from '../../core/i18n/i18n.service';
import { DateInputComponent } from './date-input.component';
import { fieldErrorMessage } from './field-errors';
import { FillerModeSelectComponent } from './filler-mode-select.component';
import { HoursInputComponent } from './hours-input.component';
import { NumberInputComponent } from './number-input.component';
import { PlaylistTypeSelectComponent } from './playlist-type-select.component';
import { applyServerErrors } from './server-errors';
import { TimeInputComponent } from './time-input.component';
import { nonEmptyValidator, rangeValidator } from './validators';
import { WeekdaysInputComponent } from './weekdays-input.component';

describe('form inputs', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  describe('fieldErrorMessage', () => {
    it('describes a range with its limits', () => {
      const i18n = TestBed.inject(I18nService);
      const translate = vi.spyOn(i18n, 'translate');
      fieldErrorMessage({ range: { min: 1, max: 3600 } }, i18n);
      expect(translate).toHaveBeenCalledWith('forms.errors.range', { min: '1', max: '3,600' });
    });

    it('prefers a server error, translated by its code', () => {
      const i18n = TestBed.inject(I18nService);
      vi.spyOn(i18n, 'has').mockReturnValue(true);
      const message = fieldErrorMessage(
        { required: true, server: { code: 'taken', message: 'code is taken' } },
        i18n,
      );
      expect(message).toBe('forms.serverErrors.taken');
    });

    it('falls back to the server message for an unknown code', () => {
      const i18n = TestBed.inject(I18nService);
      vi.spyOn(i18n, 'has').mockReturnValue(false);
      expect(fieldErrorMessage({ server: { code: 'new_code', message: 'As sent' } }, i18n)).toBe(
        'As sent',
      );
    });
  });

  it('number input is type=number with min, max, and step', () => {
    const control = new FormControl<number | null>(5, rangeValidator({ min: 1, max: 3600 }));
    const fixture = TestBed.createComponent(NumberInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('label', 'clocks.nominal');
    fixture.componentRef.setInput('min', 1);
    fixture.componentRef.setInput('max', 3600);
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(input?.type).toBe('number');
    expect(input?.min).toBe('1');
    expect(input?.max).toBe('3600');
    expect(input?.step).toBe('1');
  });

  it('shows a server error next to the field in an OnPush view', async () => {
    const form = new FormGroup({ nominal_duration_ms: new FormControl<number | null>(5) });
    const fixture = TestBed.createComponent(NumberInputComponent);
    fixture.componentRef.setInput('control', form.controls.nominal_duration_ms);
    fixture.componentRef.setInput('label', 'clocks.nominal');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('mat-error')).toBeNull();

    applyServerErrors(form, [
      { field: 'nominal_duration_ms', code: 'range', message: 'too large' },
    ]);
    await fixture.whenStable();

    const error = (fixture.nativeElement as HTMLElement).querySelector('mat-error');
    // No translations are loaded in tests, so the code's text falls back to the server message.
    expect(error?.textContent).toContain('too large');
  });

  it('time input shows HH:MM with a time list toggle', async () => {
    const fixture = TestBed.createComponent(TimeInputComponent);
    fixture.componentRef.setInput('control', new FormControl<string | null>('06:00'));
    fixture.componentRef.setInput('label', 'playRules.from');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input')?.value).toBe('06:00');
    expect(element.querySelector('mat-timepicker-toggle button')).not.toBeNull();
  });

  it('time input reads a typed time and refuses other text', async () => {
    const control = new FormControl<string | null>(null);
    const fixture = TestBed.createComponent(TimeInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('label', 'playRules.from');
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    if (!input) {
      throw new Error('No input.');
    }

    input.value = '7:05';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBe('07:05');

    input.value = '25:00';
    input.dispatchEvent(new Event('input'));
    // The timepicker updates its validity in an effect.
    await fixture.whenStable();
    expect(control.hasError('matTimepickerParse')).toBe(true);
  });

  it('date input shows the station date with a calendar toggle', async () => {
    const control = new FormControl<string | null>('2026-11-01');
    const fixture = TestBed.createComponent(DateInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('label', 'grid.validFrom');
    fixture.componentRef.setInput('min', '2026-10-15');
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input');
    expect(input?.value).toBe('2026-11-01');
    expect(element.querySelector('mat-datepicker-toggle button')).not.toBeNull();

    control.setValue('2026-10-01');
    expect(control.errors).toEqual({
      matDatepickerMin: { min: '2026-10-15', actual: '2026-10-01' },
    });
  });

  it('date input reads a typed date and refuses other text', async () => {
    const control = new FormControl<string | null>(null);
    const fixture = TestBed.createComponent(DateInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('label', 'grid.validFrom');
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    if (!input) {
      throw new Error('No input.');
    }

    input.value = ' 2026-12-31 ';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBe('2026-12-31');

    input.value = '31.12.2026';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBeNull();
    expect(control.hasError('matDatepickerParse')).toBe(true);
  });

  it('weekdays input edits a sorted list of 1 to 7 with checkboxes', () => {
    const control = new FormControl<number[] | null>([5]);
    const fixture = TestBed.createComponent(WeekdaysInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type=checkbox]',
    );
    expect(boxes).toHaveLength(7);
    expect(boxes[4].checked).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Monday');

    boxes[0].click();
    expect(control.value).toEqual([1, 5]);
    expect(control.dirty).toBe(true);
  });

  it('weekdays input follows a value set from outside', async () => {
    const control = new FormControl<number[] | null>([]);
    const fixture = TestBed.createComponent(WeekdaysInputComponent);
    fixture.componentRef.setInput('control', control);
    await fixture.whenStable();

    control.setValue([4]);
    await fixture.whenStable();
    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type=checkbox]',
    );
    expect(boxes[3].checked).toBe(true);

    control.setValue([]);
    await fixture.whenStable();
    expect(boxes[3].checked).toBe(false);
  });

  it('hours input edits a sorted list of 0 to 23 with toggle buttons', async () => {
    const control = new FormControl<number[] | null>([10], nonEmptyValidator);
    const fixture = TestBed.createComponent(HoursInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    const hours = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button.hour',
    );
    expect(hours).toHaveLength(24);
    expect(hours[10].getAttribute('aria-pressed')).toBe('true');

    hours[6].click();
    expect(control.value).toEqual([6, 10]);
    hours[10].click();
    hours[6].click();
    expect(control.value).toEqual([]);
    expect(control.hasError('required')).toBe(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error')).not.toBeNull();
  });

  it('filler mode select offers only the fallback modes for a clock default', async () => {
    const fixture = TestBed.createComponent(FillerModeSelectComponent);
    fixture.componentRef.setInput('control', new FormControl(null));
    fixture.componentRef.setInput('modes', 'default');
    await fixture.whenStable();

    const options = (
      fixture.componentInstance as unknown as { options(): readonly string[] }
    ).options();
    expect(options).toEqual(['random', 'playlist', 'artist']);
  });

  it('playlist type select reads the types from the API', async () => {
    const fixture = TestBed.createComponent(PlaylistTypeSelectComponent);
    fixture.componentRef.setInput(
      'control',
      new FormControl<number | null>(null, Validators.required),
    );
    fixture.detectChanges();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/playlist-types')
      .flush({
        items: [
          {
            id: 1,
            code: 'music',
            name: 'Music',
            is_system: true,
            playlist_count: 2,
            track_count: 10,
            created_at: '2026-10-01T00:00:00Z',
          },
        ],
      });
    await fixture.whenStable();

    const types = (
      fixture.componentInstance as unknown as { types(): { items: readonly { name: string }[] } }
    ).types();
    expect(types.items.map((type) => type.name)).toEqual(['Music']);
  });
});

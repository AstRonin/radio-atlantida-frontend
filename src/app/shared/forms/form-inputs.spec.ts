import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatHourOffset, parseHourOffset } from '../../core/time/duration';
import { ClockRule, ClockRuleInputComponent, linkClockCount } from './clock-rule-input.component';
import { DateInputComponent } from './date-input.component';
import { fieldErrorMessage } from './field-errors';
import { HoursInputComponent } from './hours-input.component';
import { IntervalInputComponent, joinMinutes, splitMinutes } from './interval-input.component';
import { NumberInputComponent } from './number-input.component';
import { OffsetInputComponent } from './offset-input.component';
import { PlaylistTypeSelectComponent } from './playlist-type-select.component';
import { SecondsInputComponent } from './seconds-input.component';
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
    expect(boxes).toHaveLength(8);
    expect(boxes[5].checked).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Monday');

    boxes[1].click();
    expect(control.value).toEqual([1, 5]);
    expect(control.dirty).toBe(true);
  });

  it('weekdays input "All" selects and clears the seven days', async () => {
    const control = new FormControl<number[] | null>([]);
    const fixture = TestBed.createComponent(WeekdaysInputComponent);
    fixture.componentRef.setInput('control', control);
    await fixture.whenStable();
    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type=checkbox]',
    );
    const all = boxes[0];
    expect(fixture.nativeElement.textContent).toContain('forms.weekdays.all');
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);

    all.click();
    await fixture.whenStable();
    expect(control.value).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(control.dirty).toBe(true);
    expect(control.touched).toBe(true);
    expect(all.checked).toBe(true);

    all.click();
    await fixture.whenStable();
    expect(control.value).toEqual([]);
    expect(all.checked).toBe(false);

    boxes[1].click();
    boxes[3].click();
    await fixture.whenStable();
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);

    // From "some", All selects every day.
    all.click();
    await fixture.whenStable();
    expect(control.value).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('weekdays input "All" follows the days', async () => {
    const control = new FormControl<number[] | null>([1, 2, 3, 4, 5, 6]);
    const fixture = TestBed.createComponent(WeekdaysInputComponent);
    fixture.componentRef.setInput('control', control);
    await fixture.whenStable();
    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type=checkbox]',
    );
    expect(boxes[0].indeterminate).toBe(true);

    boxes[7].click();
    await fixture.whenStable();
    expect(control.value).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(boxes[0].checked).toBe(true);

    control.setValue([2]);
    await fixture.whenStable();
    expect(boxes[0].checked).toBe(false);
    expect(boxes[0].indeterminate).toBe(true);

    control.disable();
    await fixture.whenStable();
    expect(boxes[0].disabled).toBe(true);
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
    expect(boxes[4].checked).toBe(true);

    control.setValue([]);
    await fixture.whenStable();
    expect(boxes[4].checked).toBe(false);
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

  describe('offset input (frontend F21 §5.1)', () => {
    it('reads and writes a time in the hour with seconds', () => {
      expect(parseHourOffset('29:40')).toBe(1_780_000);
      expect(parseHourOffset('5:07')).toBe(307_000);
      expect(parseHourOffset('59:59')).toBe(3_599_000);
      expect(parseHourOffset('60:00')).toBeNull();
      expect(parseHourOffset('5:7x')).toBeNull();
      expect(parseHourOffset('5:7')).toBeNull();
      expect(formatHourOffset(1_780_000)).toBe('29:40');
      expect(formatHourOffset(0)).toBe('00:00');
    });

    async function offsetField(value: number | null) {
      const control = new FormControl<number | null>(value);
      const fixture = TestBed.createComponent(OffsetInputComponent);
      fixture.componentRef.setInput('control', control);
      fixture.componentRef.setInput('label', 'clocks.inserts.offset');
      await fixture.whenStable();
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        'input',
      ) as HTMLInputElement;
      return { control, input };
    }

    it('refuses text that is not a time in the hour', async () => {
      const { control, input } = await offsetField(1_780_000);
      expect(input.value).toBe('29:40');

      input.value = '60:00';
      input.dispatchEvent(new Event('input'));
      expect(control.value).toBeNull();
      expect(control.hasError('hourOffset')).toBe(true);

      input.value = '30:00';
      input.dispatchEvent(new Event('input'));
      expect(control.value).toBe(1_800_000);
      expect(control.valid).toBe(true);
    });

    it('steps one second with the arrows and one minute with Shift or Page keys', async () => {
      const { control, input } = await offsetField(1_780_000);
      const press = (key: string, shiftKey = false) =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }));

      press('ArrowUp');
      expect(control.value).toBe(1_781_000);
      press('ArrowUp', true);
      expect(control.value).toBe(1_841_000);
      press('PageDown');
      expect(control.value).toBe(1_781_000);
      expect(input.value).toBe('29:41');

      control.setValue(0);
      press('ArrowDown');
      expect(control.value).toBe(0);
      control.setValue(3_599_000);
      press('PageUp');
      expect(control.value).toBe(3_599_000);
    });
  });

  describe('interval input (frontend F21 §5.6)', () => {
    it('turns hours and minutes into minutes and back', () => {
      expect(joinMinutes(72, null)).toBe(4_320);
      expect(joinMinutes(1, 30)).toBe(90);
      expect(joinMinutes(null, null)).toBeNull();
      expect(splitMinutes(4_320)).toEqual({ hours: 72, minutes: 0 });
      expect(splitMinutes(null)).toEqual({ hours: null, minutes: null });
    });

    it('edits the minutes of the control and follows a value set from outside', async () => {
      const control = new FormControl<number | null>(90);
      const fixture = TestBed.createComponent(IntervalInputComponent);
      fixture.componentRef.setInput('control', control);
      fixture.componentRef.setInput('label', 'playRules.fields.min_interval_minutes');
      await fixture.whenStable();
      const [hours, minutes] = [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll('input'),
      ] as HTMLInputElement[];
      expect([hours.value, minutes.value]).toEqual(['1', '30']);

      hours.value = '72';
      hours.dispatchEvent(new Event('input'));
      minutes.value = '';
      minutes.dispatchEvent(new Event('input'));
      expect(control.value).toBe(4_320);
      expect(control.dirty).toBe(true);

      control.setValue(20);
      await fixture.whenStable();
      expect([hours.value, minutes.value]).toEqual(['0', '20']);

      control.setValue(null);
      await fixture.whenStable();
      expect([hours.value, minutes.value]).toEqual(['', '']);
    });
  });

  describe('clock rule input (frontend F21 §5.1)', () => {
    async function ruleField(rule: ClockRule, inherited?: { rule: ClockRule; count?: number }) {
      const ruleControl = new FormControl<ClockRule | null>(rule);
      const count = new FormControl<number | null>(null);
      TestBed.runInInjectionContext(() => {
        linkClockCount(ruleControl, count, TestBed.inject(DestroyRef));
      });
      const fixture = TestBed.createComponent(ClockRuleInputComponent);
      fixture.componentRef.setInput('rule', ruleControl);
      fixture.componentRef.setInput('count', count);
      if (inherited) {
        fixture.componentRef.setInput('inherited', inherited);
      }
      await fixture.whenStable();
      return { ruleControl, count, fixture, page: fixture.nativeElement as HTMLElement };
    }

    it('shows and requires the count only for spread', async () => {
      const { ruleControl, count, fixture, page } = await ruleField('fill');
      expect(page.querySelector('app-number-input')).toBeNull();
      expect(count.disabled).toBe(true);

      ruleControl.setValue('spread');
      await fixture.whenStable();
      expect(page.querySelector('app-number-input')).not.toBeNull();
      expect(count.hasError('required')).toBe(true);
      count.setValue(13);
      expect(count.hasError('range')).toBe(true);
      count.setValue(2);
      expect(count.valid).toBe(true);

      ruleControl.setValue('middle');
      await fixture.whenStable();
      expect(count.disabled).toBe(true);
    });

    it('names the own rule of the playlist when it overrides it', async () => {
      const i18n = TestBed.inject(I18nService);
      const translate = vi.spyOn(i18n, 'translate');
      const { page } = await ruleField('start', { rule: 'spread', count: 2 });
      expect(translate).toHaveBeenCalledWith('forms.clockRule.spreadCount', { count: 2 });
      expect(page.textContent).toContain('forms.clockRule.inherited');
    });
  });

  it('seconds input shows seconds and keeps milliseconds, checking the range in seconds', async () => {
    const control = new FormControl<number | null>(60_000);
    const fixture = TestBed.createComponent(SecondsInputComponent);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('label', 'clocks.inserts.tolerance');
    fixture.componentRef.setInput('max', 600);
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('60');

    input.value = '90';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBe(90_000);
    expect(control.valid).toBe(true);

    input.value = '601';
    input.dispatchEvent(new Event('input'));
    expect(control.hasError('range')).toBe(true);
  });
});

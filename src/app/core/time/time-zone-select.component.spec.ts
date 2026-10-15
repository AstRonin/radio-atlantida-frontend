import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { TimeZoneSelectComponent, timeZoneNames } from './time-zone-select.component';

describe('TimeZoneSelectComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('lists IANA names, sorted, with UTC and the default', () => {
    const names = timeZoneNames();
    expect(names).toContain('Asia/Yerevan');
    expect(names).toContain('UTC');
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('is a select bound to the control, never a text input', () => {
    const control = new FormControl<string | null>('Asia/Yerevan', Validators.required);
    const fixture = TestBed.createComponent(TimeZoneSelectComponent);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-select')).not.toBeNull();
    expect(element.querySelector('input')).toBeNull();
    expect(element.querySelector('mat-label')?.textContent).toContain('time.zoneLabel');
  });

  it('keeps a saved value the browser does not list', () => {
    const control = new FormControl<string | null>('Etc/Unlisted');
    const fixture = TestBed.createComponent(TimeZoneSelectComponent);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    const options = (
      fixture.componentInstance as unknown as { options(): readonly string[] }
    ).options();
    expect(options[0]).toBe('Etc/Unlisted');
    expect(control.value).toBe('Etc/Unlisted');
  });
});

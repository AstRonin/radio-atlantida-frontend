import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StationTimeService } from '../../core/time/station-time.service';
import { AirWindowListComponent, AirWindowRow } from './air-window-list.component';

// ICU separates AM/PM with a narrow no-break space; compare with plain spaces.
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

// 14:01 in Yerevan (UTC+4) on 2026-10-15.
const NOW = Date.parse('2026-10-15T10:01:00Z');

function row(overrides: Partial<AirWindowRow>): AirWindowRow {
  return {
    kind: 'played',
    status: 'aired',
    item_id: 1,
    track_id: 1,
    title: 'Song',
    artist_name: null,
    source: 'plan',
    start_utc: '2026-10-15T09:50:00Z',
    end_utc: '2026-10-15T09:53:20Z',
    truncated: false,
    resolution: null,
    outage_id: null,
    in_liquidsoap: false,
    ...overrides,
  };
}

const yesterdayMissed = row({
  item_id: 10,
  status: 'missed',
  title: 'Late News',
  start_utc: '2026-10-14T19:50:00Z',
  end_utc: '2026-10-14T19:53:00Z',
  resolution: 'rescheduled',
  outage_id: 3,
});
const aired = row({ item_id: 11, title: 'Morning Song', artist_name: 'Ani' });
const missed = row({
  item_id: 12,
  status: 'missed',
  title: 'Hourly News',
  start_utc: '2026-10-15T09:53:20Z',
  end_utc: '2026-10-15T09:56:40Z',
  resolution: 'open',
  outage_id: 4,
});
const truncated = row({
  item_id: 13,
  status: 'truncated',
  title: 'Long Song',
  start_utc: '2026-10-15T09:56:40Z',
  end_utc: '2026-10-15T10:00:00Z',
});
const now = row({
  kind: 'now',
  status: 'now',
  item_id: 14,
  title: 'Current Song',
  start_utc: '2026-10-15T10:00:00Z',
  end_utc: '2026-10-15T10:04:00Z',
  in_liquidsoap: true,
});
const inLiquidsoap = row({
  kind: 'queued',
  status: 'queued',
  item_id: 15,
  title: 'Next Song',
  start_utc: '2026-10-15T10:04:00Z',
  end_utc: '2026-10-15T10:07:00Z',
  in_liquidsoap: true,
});
const planned = row({
  kind: 'queued',
  status: 'planned',
  item_id: 16,
  title: 'Later Song',
  source: 'plan',
  start_utc: '2026-10-15T10:07:00Z',
  end_utc: '2026-10-15T10:10:00Z',
});

describe('AirWindowListComponent', () => {
  let fixture: ComponentFixture<AirWindowListComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(StationTimeService).setZone('Asia/Yerevan');
    fixture = TestBed.createComponent(AirWindowListComponent);
  });

  function show(rows: AirWindowRow[], connected = true, at = NOW): HTMLElement {
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('controlLinkConnected', connected);
    fixture.componentRef.setInput('now', at);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const bodyRows = (page: HTMLElement) => [...page.querySelectorAll('tbody tr')];
  const cells = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => plain(td.textContent));

  it('shows the rows in the given order with a badge for each status', () => {
    const page = show([aired, missed, truncated, now, inLiquidsoap, planned]);

    const rows = bodyRows(page);
    expect(rows.map((tr) => cells(tr)[4])).toEqual([
      'Morning Song',
      'Hourly News',
      'Long Song',
      'Current Song',
      'Next Song',
      'Later Song',
    ]);
    const badges = rows.map((tr) => plain(tr.querySelector('.badge')?.textContent));
    expect(badges).toEqual([
      'airWindow.statuses.aired',
      'airWindow.statuses.missed',
      'airWindow.statuses.truncated',
      'airWindow.statuses.now',
      'airWindow.statuses.queued',
      'airWindow.statuses.planned',
    ]);
    expect(cells(rows[0])[3]).toBe('Ani');
    expect(cells(rows[0])[5]).toBe('airWindow.sources.plan');
    expect(rows[3].classList).toContain('now');
    expect(page.querySelector('.playout-unknown')).toBeNull();
    expect(page.querySelector('.nothing-on-air')).toBeNull();
  });

  it('marks a missed row as not aired with its resolution and a link to resolve it', () => {
    const page = show([yesterdayMissed, missed]);
    const [resolved, open] = bodyRows(page);

    expect(resolved.classList).toContain('missed');
    expect(resolved.querySelector('.badge.warn')?.textContent).toContain(
      'airWindow.statuses.missed',
    );
    expect(resolved.textContent).toContain('airWindow.resolutions.rescheduled');
    expect(resolved.querySelector('a')).toBeNull();

    expect(open.textContent).toContain('airWindow.resolutions.open');
    expect(open.querySelector('a')?.getAttribute('href')).toBe('/missed-items');
  });

  it('shows the elapsed time of the now row against its length', () => {
    const page = show([now]);
    const nowRow = bodyRows(page)[0];

    expect(plain(nowRow.querySelector('.detail .time')?.textContent)).toBe('1:00 / 4:00');
    expect(nowRow.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('25');

    // Past the end and no event yet: the row stays, held at 100 %.
    show([now], true, Date.parse('2026-10-15T10:05:00Z'));
    expect(nowRow.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('shows times in the station zone, with the date for another day', () => {
    let page = show([yesterdayMissed, aired]);
    let rows = bodyRows(page);
    expect(cells(rows[0])[0]).toBe('Oct 14, 2026, 11:50:00 PM');
    expect(cells(rows[1])[0]).toBe('1:50:00 PM');
    expect(cells(rows[1])[1]).toBe('1:53:20 PM');

    TestBed.inject(StationTimeService).setZone('UTC');
    page = show([yesterdayMissed, aired]);
    rows = bodyRows(page);
    expect(cells(rows[0])[0]).toBe('Oct 14, 2026, 7:50:00 PM');
    expect(cells(rows[1])[0]).toBe('9:50:00 AM');
  });

  it('warns that playout is unknown without the control link and still shows the rows', () => {
    const page = show([aired, inLiquidsoap], false);

    expect(page.querySelector('.playout-unknown')?.textContent).toContain(
      'airWindow.playoutUnknown',
    );
    expect(bodyRows(page)).toHaveLength(2);
    expect(page.querySelector('.nothing-on-air')).toBeNull();
  });

  it('says nothing is on air between played and queued rows while connected', () => {
    const page = show([aired, inLiquidsoap]);

    const rows = bodyRows(page);
    expect(rows).toHaveLength(3);
    expect(rows[1].classList).toContain('nothing-on-air');
    expect(rows[1].textContent).toContain('airWindow.nothingOnAir');
    expect(page.querySelector('.playout-unknown')).toBeNull();

    const playedOnly = show([aired]);
    expect(bodyRows(playedOnly)[1].classList).toContain('nothing-on-air');
  });

  it('says there is no plan when no rows come, with a link to the track plan', () => {
    const page = show([]);

    expect(page.querySelector('table')).toBeNull();
    expect(page.textContent).toContain('airWindow.empty');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/track-plan');
  });
});

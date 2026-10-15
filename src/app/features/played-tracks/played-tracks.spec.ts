import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import PlayedTracksPageComponent, { outageChunks } from './played-tracks-page.component';

type PlayHistoryEntry = ApiSchema<'PlayHistoryEntry'>;
type Outage = ApiSchema<'Outage'>;

// Today is 2026-10-15 in Yerevan (UTC+4): the default range is the 14th and the 15th.
const FROM = '2026-10-13T20:00:00.000Z';
const TO = '2026-10-15T20:00:00.000Z';

const aired: PlayHistoryEntry = {
  id: 21,
  status: 'aired',
  source: 'auto',
  track_id: 7,
  title: 'Morning Song',
  artist_name: 'Ani',
  planned_start_utc: '2026-10-15T00:30:00Z',
  started_at: '2026-10-15T00:30:01Z',
  planned_out_ms: 200_000,
  actual_duration_ms: 199_000,
  clock: { id: 2, name: 'Night' },
};

const missed: PlayHistoryEntry = {
  id: 20,
  status: 'missed',
  source: 'auto',
  track_id: 8,
  title: 'Hourly News',
  planned_start_utc: '2026-10-15T00:10:00Z',
  planned_out_ms: 180_000,
  clock: { id: 3 },
  outage: { id: 4, component: 'icecast', reason: 'mount missing' },
  resolution: 'open',
};

const outage: Outage = {
  id: 4,
  started_at: '2026-10-15T00:05:00Z',
  ended_at: '2026-10-15T00:12:00Z',
  detected_by: 'icecast',
  component: 'icecast',
  reason: 'mount missing',
  missed_count: 1,
};

interface PlayedTracksView {
  form: FormGroup<{
    from: FormControl<string | null>;
    to: FormControl<string | null>;
    status: FormControl<string | null>;
  }>;
}

describe('outageChunks', () => {
  it('splits a range into pieces of at most 7 days', () => {
    expect(outageChunks({ from: FROM, to: TO })).toEqual([{ from: FROM, to: TO }]);
    const chunks = outageChunks({
      from: '2026-09-14T20:00:00.000Z',
      to: '2026-10-15T20:00:00.000Z',
    });
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toEqual({ from: '2026-09-14T20:00:00.000Z', to: '2026-09-21T20:00:00.000Z' });
    expect(chunks[4]).toEqual({ from: '2026-10-12T20:00:00.000Z', to: '2026-10-15T20:00:00.000Z' });
  });
});

describe('PlayedTracksPageComponent', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        provideFakeAudio(new FakeAudio()),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
    vi.useRealTimers();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  function expectHistory(
    params: Record<string, string | null>,
    items: PlayHistoryEntry[],
    next_cursor?: string,
  ): void {
    const expected: Record<string, string | null> = {
      from: FROM,
      to: TO,
      limit: '100',
      status: null,
      cursor: null,
      ...params,
    };
    http
      .expectOne(
        (req) =>
          req.url === '/api/play-history' &&
          Object.entries(expected).every(([name, value]) => req.params.get(name) === value),
      )
      .flush({ items, next_cursor });
  }

  function expectOutages(from: string, to: string, items: Outage[]): void {
    http
      .expectOne(
        (req) =>
          req.url === '/api/outages' &&
          req.params.get('from') === from &&
          req.params.get('to') === to,
      )
      .flush({ items });
  }

  async function open(): Promise<ComponentFixture<unknown>> {
    const fixture = TestBed.createComponent(PlayedTracksPageComponent);
    await settlePage();
    expectHistory({}, [aired, missed]);
    expectOutages(FROM, TO, [outage]);
    await settlePage();
    return fixture;
  }

  it('reads yesterday and today of the station and marks missed items', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    const rows = page.querySelectorAll('.history tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Morning Song');
    expect(rows[0].textContent).toContain('playedTracks.statuses.aired');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/clocks/2');

    const missedRow = rows[1];
    expect(missedRow.classList).toContain('missed');
    expect(missedRow.querySelector('.badge.warn')?.textContent).toContain(
      'playedTracks.statuses.missed',
    );
    expect(missedRow.textContent).toContain('mount missing');
    expect(missedRow.textContent).toContain('playedTracks.deletedClock');
    const resolve = [...missedRow.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === 'playedTracks.resolve',
    );
    expect(resolve?.getAttribute('href')).toBe('/missed-items');

    expect(page.querySelectorAll('app-outage-list tbody tr')).toHaveLength(1);
    expect(page.querySelector('app-outage-list')?.textContent).toContain(
      'outages.detectedBy.icecast',
    );
  });

  it('filters by status and loads older pages with the cursor', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    (fixture.componentInstance as PlayedTracksView).form.controls.status.setValue('missed');
    await settlePage();
    expectHistory({ status: 'missed' }, [missed], 'c1');
    await settlePage();
    expect(page.querySelectorAll('.history tbody tr')).toHaveLength(1);

    button(page, 'common.loadMore')?.click();
    expectHistory({ status: 'missed', cursor: 'c1' }, [{ ...missed, id: 19 }]);
    await settlePage();

    expect(page.querySelectorAll('.history tbody tr')).toHaveLength(2);
    expect(button(page, 'common.loadMore')).toBeUndefined();
  });

  it('reads the outages of a long range in 7-day pieces', async () => {
    const fixture = await open();
    const form = (fixture.componentInstance as PlayedTracksView).form;

    form.patchValue({ from: '2026-09-15', to: '2026-10-15' });
    await settlePage();
    expectHistory({ from: '2026-09-14T20:00:00.000Z' }, []);
    const chunks = http.match((req) => req.url === '/api/outages');
    expect(chunks).toHaveLength(5);
    chunks.forEach((request) => request.flush({ items: [outage] }));
    await settlePage();

    // The same outage from two pieces is shown once.
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelectorAll('app-outage-list tbody tr')).toHaveLength(1);
  });

  it('refuses a range longer than 31 days', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const form = (fixture.componentInstance as PlayedTracksView).form;

    form.patchValue({ from: '2026-09-14', to: '2026-10-15' });
    await settlePage();

    expect(form.controls.to.hasError('dateRange')).toBe(true);
    expect(button(page, 'playedTracks.refresh')?.disabled).toBe(true);
    http.expectNone((req) => req.url === '/api/play-history');
  });

  it('reloads when items are marked missed and outages when one ends', async () => {
    await open();

    server.latest.send({
      type: 'missed_items.completed',
      time: '2026-10-15T00:12:05Z',
      operation_id: 9,
      data: { kind: 'missed_items', summary: '1 missed' },
    });
    await settlePage();
    expectHistory({}, [aired, missed]);
    expectOutages(FROM, TO, [outage]);
    await settlePage();

    server.latest.send({
      type: 'broadcast_outage.ended',
      time: '2026-10-15T00:12:06Z',
      data: {
        outage_id: 4,
        started_at: outage.started_at,
        ended_at: '2026-10-15T00:12:00Z',
        component: 'icecast',
        missed_count: 1,
      },
    });
    await settlePage();
    expectOutages(FROM, TO, [outage]);
    http.expectNone((req) => req.url === '/api/play-history');
  });
});

import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LibraryPageComponent from './library-page.component';
import { BulkDeleteResult, TrackRefusal, trackBulkDelete } from './track-bulk-delete';
import { TrackDeleteResultComponent } from './track-delete-result.component';
import type { Track } from './track-form';

const track = (id: number): Track => ({
  id,
  title: `Song ${id}`,
  duration_ms: 225_000,
  file_path: `music/${id}.mp3`,
  format: 'mp3',
  quality_ok: true,
  quality_issues: [],
  fixes: [],
  play_rule_ids: [],
  playlist_ids: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
});

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class HostComponent {
  readonly done: (readonly number[])[] = [];
  readonly bulk = trackBulkDelete((deleted) => this.done.push(deleted));
}

describe('bulk track delete', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        provideFakeAudio(new FakeAudio()),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  describe('trackBulkDelete', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    beforeEach(() => {
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
    });

    it('sends the IDs in selection order and keeps the result', () => {
      host.bulk.start([5, 2, 9]);
      expect(host.bulk.running()).toBe(true);
      expect(host.bulk.count()).toBe(3);
      const request = http.expectOne({ method: 'POST', url: '/api/tracks/delete' });
      expect(request.request.body).toEqual({ track_ids: [5, 2, 9] });

      request.flush({ deleted: [5, 9], refused: [{ track_id: 2, code: 'track_has_history' }] });
      expect(host.bulk.running()).toBe(false);
      expect(host.bulk.result()).toEqual({
        requested: 3,
        deleted: [5, 9],
        refused: [{ track_id: 2, code: 'track_has_history' }],
      });
      expect(host.done).toEqual([[5, 9]]);

      host.bulk.clear();
      expect(host.bulk.result()).toBeNull();
    });

    it('names a refused body and reports no deleted tracks', () => {
      host.bulk.start([1]);
      http.expectOne('/api/tracks/delete').flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          detail: 'The request has invalid fields.',
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      expect(host.bulk.error()).toBeTruthy();
      expect(host.bulk.result()).toBeNull();
      expect(host.done).toEqual([[]]);
    });

    it('keeps the count of a 500 detail next to the generic text', () => {
      host.bulk.start([1, 2]);
      http.expectOne('/api/tracks/delete').flush(
        {
          status: 500,
          code: 'internal_error',
          title: 'Internal Server Error',
          detail: 'deleted 1 of 2 tracks before the error',
        },
        { status: 500, statusText: 'Internal Server Error' },
      );
      expect(host.bulk.error()).toContain('deleted 1 of 2 tracks before the error');
      expect(host.done).toEqual([[]]);
    });

    it('cancels the request when the page is left', () => {
      host.bulk.start([1]);
      const request = http.expectOne('/api/tracks/delete');
      fixture.destroy();
      expect(request.cancelled).toBe(true);
    });
  });

  describe('TrackDeleteResultComponent', () => {
    async function render(result: BulkDeleteResult): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(TrackDeleteResultComponent);
      fixture.componentRef.setInput('result', result);
      await settlePage();
      return fixture.nativeElement as HTMLElement;
    }

    it('lists at most 20 refusals, then the rest as a count', async () => {
      const refused: TrackRefusal[] = Array.from({ length: 23 }, (_, i) => ({
        track_id: i + 1,
        code: 'track_has_history',
        title: `Song ${i + 1}`,
      }));
      const element = await render({ requested: 30, deleted: [100], refused });
      expect(element.querySelector('[role="status"]')?.textContent).toContain(
        'library.bulkDelete.done',
      );
      expect(element.querySelectorAll('li')).toHaveLength(20);
      expect(element.textContent).toContain('library.bulkDelete.moreRefused');
    });

    it('shows #id for a missing track and links the clocks of a filler pool', async () => {
      const element = await render({
        requested: 2,
        deleted: [],
        refused: [
          { track_id: 7, code: 'track_not_found' },
          {
            track_id: 8,
            code: 'track_in_use',
            title: 'Song 8',
            used_by: [{ kind: 'clock', id: 3, name: 'Morning' }],
          },
        ],
      });
      const items = element.querySelectorAll('li');
      expect(items[0].textContent).toContain('#7');
      expect(items[0].textContent).toContain('problems.track_not_found');
      expect(items[1].textContent).toContain('problems.track_in_use');
      expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/clocks/3');
      expect(element.textContent).not.toContain('library.bulkDelete.moreRefused');
    });
  });

  describe('LibraryPageComponent', () => {
    let overlay: HTMLElement;

    beforeEach(() => {
      overlay = TestBed.inject(OverlayContainer).getContainerElement();
      TestBed.inject(RealtimeService).connect();
      server.latest.open();
    });

    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) => element.textContent?.trim() === label,
      );
    const tracksRequest = () => http.expectOne((req) => req.url === '/api/tracks');
    const checked = (page: HTMLElement) =>
      [...page.querySelectorAll('tr.mat-mdc-row')].flatMap((row, index) =>
        row.querySelector('mat-checkbox.mat-mdc-checkbox-checked') ? [index] : [],
      );

    async function open(rows: Track[]): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(LibraryPageComponent);
      await settlePage();
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/playlist-types').flush({ items: [] });
      tracksRequest().flush({ items: rows, total: rows.length });
      await settlePage();
      return fixture.nativeElement as HTMLElement;
    }

    async function selectAll(page: HTMLElement): Promise<void> {
      page.querySelector<HTMLInputElement>('th mat-checkbox input')?.click();
      await settlePage();
    }

    async function confirmDelete(page: HTMLElement): Promise<void> {
      button(page, 'library.bulkDelete.delete')?.click();
      await settlePage();
      expect(overlay.textContent).toContain('library.bulkDelete.confirmTitle');
      button(overlay, 'common.delete')?.click();
      await settlePage();
    }

    it('shows Delete only with a selection and sends nothing when cancelled', async () => {
      const page = await open([track(1), track(2)]);
      expect(button(page, 'library.bulkDelete.delete')).toBeUndefined();

      await selectAll(page);
      button(page, 'library.bulkDelete.delete')?.click();
      await settlePage();
      button(overlay, 'common.cancel')?.click();
      await settlePage();
      http.expectNone('/api/tracks/delete');
    });

    it('deletes with one request, keeps the refused tracks selected, and lists why', async () => {
      const rows = [1, 2, 3, 4, 5, 6].map(track);
      const page = await open(rows);
      await selectAll(page);

      await confirmDelete(page);
      const request = http.expectOne({ method: 'POST', url: '/api/tracks/delete' });
      expect(request.request.body).toEqual({ track_ids: [1, 2, 3, 4, 5, 6] });
      http.expectNone((req) => req.method === 'DELETE');
      expect(page.textContent).toContain('library.bulkDelete.running');
      expect(button(page, 'library.bulkDelete.delete')?.disabled).toBe(true);

      request.flush({
        deleted: [1, 3, 5, 6],
        refused: [
          { track_id: 2, code: 'track_has_history', title: 'Song 2' },
          {
            track_id: 4,
            code: 'track_in_use',
            title: 'Song 4',
            used_by: [{ kind: 'clock', id: 9, name: 'Evening' }],
          },
        ],
      });
      await settlePage();
      tracksRequest().flush({ items: [track(2), track(4)], total: 2 });
      await settlePage();

      expect(checked(page)).toEqual([0, 1]);
      const result = page.querySelector('app-track-delete-result');
      expect(result?.textContent).toContain('library.bulkDelete.done');
      expect(result?.textContent).toContain('problems.track_has_history');
      expect(result?.querySelector('a')?.getAttribute('href')).toBe('/clocks/9');

      // A new choice starts over.
      page.querySelectorAll<HTMLInputElement>('tr.mat-mdc-row mat-checkbox input')[0].click();
      await settlePage();
      expect(page.querySelector('app-track-delete-result')).toBeNull();
    });

    it('keeps the selection and reads the list again after a server error', async () => {
      const page = await open([track(1), track(2)]);
      await selectAll(page);
      await confirmDelete(page);
      http.expectOne('/api/tracks/delete').flush(
        {
          status: 500,
          code: 'internal_error',
          title: 'Internal Server Error',
          detail: 'deleted 1 of 2 tracks before the error',
        },
        { status: 500, statusText: 'Internal Server Error' },
      );
      await settlePage();
      tracksRequest().flush({ items: [track(1), track(2)], total: 2 });
      await settlePage();
      expect(page.querySelector('.form-error')?.textContent).toContain('deleted 1 of 2');
      expect(checked(page)).toEqual([0, 1]);
    });

    it('disables Delete above 1,000 tracks and while a media operation runs', async () => {
      const page = await open(Array.from({ length: 1001 }, (_, i) => track(i + 1)));
      await selectAll(page);
      expect(button(page, 'library.bulkDelete.delete')?.disabled).toBe(true);
      expect(page.textContent).toContain('library.bulkDelete.tooMany');

      page.querySelector<HTMLInputElement>('tr.mat-mdc-row mat-checkbox input')?.click();
      await settlePage();
      expect(button(page, 'library.bulkDelete.delete')?.disabled).toBe(false);
      expect(page.textContent).not.toContain('library.bulkDelete.tooMany');

      button(page, 'library.media.analyse')?.click();
      http
        .expectOne({ method: 'POST', url: '/api/tracks/analyse' })
        .flush({ operation_id: 70 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'library.bulkDelete.delete')?.disabled).toBe(true);
    });
  });
});

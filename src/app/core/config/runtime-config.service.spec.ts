import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RUNTIME_CONFIG_PATH, RuntimeConfigService, grafanaUrlOf } from './runtime-config.service';

describe('grafanaUrlOf', () => {
  it('accepts an absolute http or https URL and drops the trailing slash', () => {
    expect(grafanaUrlOf({ grafana_url: 'http://127.0.0.1:3000' })).toBe('http://127.0.0.1:3000');
    expect(grafanaUrlOf({ grafana_url: ' https://grafana.local/ ' })).toBe('https://grafana.local');
    expect(grafanaUrlOf({ grafana_url: 'http://host:3000/grafana/' })).toBe(
      'http://host:3000/grafana',
    );
  });

  it('treats a missing, empty, relative, or non-http value as monitoring off', () => {
    expect(grafanaUrlOf(null)).toBeNull();
    expect(grafanaUrlOf('http://127.0.0.1:3000')).toBeNull();
    expect(grafanaUrlOf({})).toBeNull();
    expect(grafanaUrlOf({ grafana_url: '' })).toBeNull();
    expect(grafanaUrlOf({ grafana_url: 3000 })).toBeNull();
    expect(grafanaUrlOf({ grafana_url: '/grafana' })).toBeNull();
    expect(grafanaUrlOf({ grafana_url: 'javascript:alert(1)' })).toBeNull();
    expect(grafanaUrlOf({ grafana_url: '${GRAFANA_URL}' })).toBeNull();
  });
});

describe('RuntimeConfigService', () => {
  let http: HttpTestingController;
  let config: RuntimeConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    config = TestBed.inject(RuntimeConfigService);
  });

  afterEach(() => http.verify());

  it('has no Grafana address before the configuration is read', () => {
    expect(config.grafanaUrl()).toBeNull();
  });

  it('reads the configuration once', () => {
    config.load();
    config.load();
    http.expectOne(RUNTIME_CONFIG_PATH).flush({ grafana_url: 'http://127.0.0.1:3000/' });
    expect(config.grafanaUrl()).toBe('http://127.0.0.1:3000');
  });

  it('shows no link when the file is missing', () => {
    config.load();
    http
      .expectOne(RUNTIME_CONFIG_PATH)
      .flush('not found', { status: 404, statusText: 'Not Found' });
    expect(config.grafanaUrl()).toBeNull();
  });
});

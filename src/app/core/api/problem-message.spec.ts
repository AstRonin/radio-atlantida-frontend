import { I18nService } from '../i18n/i18n.service';
import { ApiProblem } from './api-problem';
import { problemMessage } from './problem-message';

describe('problemMessage', () => {
  const i18n = {
    has: (key: string) => key === 'problems.playlist_type_in_use',
    translate: (key: string) => `translated ${key}`,
  } as Pick<I18nService, 'has' | 'translate'> as I18nService;

  it('translates by code', () => {
    const problem = new ApiProblem({
      status: 409,
      code: 'playlist_type_in_use',
      title: 'Playlist type in use',
      detail: 'Type 3 is used by 2 playlists.',
    });
    expect(problemMessage(problem, i18n)).toBe('translated problems.playlist_type_in_use');
  });

  it('falls back to the detail, then the title', () => {
    const withDetail = new ApiProblem({
      status: 404,
      code: 'track_not_found',
      title: 'Track not found',
      detail: 'Track 5 does not exist.',
    });
    expect(problemMessage(withDetail, i18n)).toBe('Track 5 does not exist.');
    expect(
      problemMessage(new ApiProblem({ status: 500, code: 'internal_error', title: 'Oops' }), i18n),
    ).toBe('Oops');
  });
});

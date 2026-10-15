import live from '../../../assets/help/en/live.json';
import library from '../../../assets/help/en/library.json';
import playlists from '../../../assets/help/en/playlists.json';
import playlistTypes from '../../../assets/help/en/playlist-types.json';
import clocks from '../../../assets/help/en/clocks.json';
import grid from '../../../assets/help/en/grid.json';
import playRules from '../../../assets/help/en/play-rules.json';
import separationRules from '../../../assets/help/en/separation-rules.json';
import playedTracks from '../../../assets/help/en/played-tracks.json';
import trackPlan from '../../../assets/help/en/track-plan.json';
import fillerReminders from '../../../assets/help/en/filler-reminders.json';
import missedItems from '../../../assets/help/en/missed-items.json';
import logs from '../../../assets/help/en/logs.json';
import settings from '../../../assets/help/en/settings.json';
import { HELP_PAGE_IDS, HelpPageId, helpFileName, isHelpContent } from './help-content';

// Typed by page ID: a page ID without an English help file is a compile error here, and a missing
// file fails the import.
const ENGLISH: Record<HelpPageId, unknown> = {
  'help.live': live,
  'help.library': library,
  'help.playlists': playlists,
  'help.playlist-types': playlistTypes,
  'help.clocks': clocks,
  'help.grid': grid,
  'help.play-rules': playRules,
  'help.separation-rules': separationRules,
  'help.played-tracks': playedTracks,
  'help.track-plan': trackPlan,
  'help.filler-reminders': fillerReminders,
  'help.missed-items': missedItems,
  'help.logs': logs,
  'help.settings': settings,
};

describe('help files', () => {
  it('has an English file for every page ID', () => {
    expect(Object.keys(ENGLISH).sort()).toEqual([...HELP_PAGE_IDS].sort());
  });

  it.each(HELP_PAGE_IDS)('%s has every required section', (page) => {
    const file = ENGLISH[page];
    expect(isHelpContent(file)).toBe(true);
  });

  it('names files after the page ID without the prefix', () => {
    expect(helpFileName('help.play-rules')).toBe('play-rules.json');
  });

  it('rejects a file with a missing or empty section', () => {
    const complete = ENGLISH['help.clocks'] as Record<string, unknown>;
    expect(isHelpContent({ ...complete, mistakes: [] })).toBe(false);
    expect(isHelpContent({ ...complete, example: { title: 'x' } })).toBe(false);
    expect(isHelpContent({ ...complete, fields: { name: 'no label' } })).toBe(false);
    expect(isHelpContent({ ...complete, summary: undefined })).toBe(false);
  });
});

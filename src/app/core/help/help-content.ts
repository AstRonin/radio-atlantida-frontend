/**
 * Page IDs of the admin help (design §6.1). A page may only name an ID from this list, and the help
 * file check (help-content.spec.ts) fails when an ID has no file, so a help button can never point
 * at missing help.
 */
export const HELP_PAGE_IDS = [
  'help.live',
  'help.air-window',
  'help.library',
  'help.import',
  'help.playlists',
  'help.playlist-types',
  'help.clocks',
  'help.grid',
  'help.play-rules',
  'help.played-tracks',
  'help.track-plan',
  'help.missed-items',
  'help.logs',
  'help.settings',
] as const;

export type HelpPageId = (typeof HELP_PAGE_IDS)[number];

export interface HelpTerm {
  term: string;
  text: string;
}

/** A field hint: the field's label as the form shows it, and a short explanation. */
export interface HelpField {
  label: string;
  text: string;
}

export interface HelpExample {
  title: string;
  text: string;
}

/** Short notes for the create, edit, and delete modes of the page's form or dialog. */
export interface HelpOperations {
  create?: string;
  edit?: string;
  delete?: string;
}

/**
 * One help file: `assets/help/<lang>/<page>.json`, where `<page>` is the ID without `help.`.
 * Field hints are keyed by the form control name, which is the DTO's JSON name.
 */
export interface HelpContent {
  title: string;
  /** What the page is. */
  summary: string;
  /** What its entities mean. */
  entities: HelpTerm[];
  /** How to use them. */
  usage: string;
  steps: string[];
  mistakes: string[];
  example: HelpExample;
  operations: HelpOperations;
  fields: Record<string, HelpField>;
}

/** File name of a page's help, without the folder: `help.play-rules` -> `play-rules.json`. */
export function helpFileName(page: HelpPageId): string {
  return `${page.slice('help.'.length)}.json`;
}

export function isHelpContent(value: unknown): value is HelpContent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isText(value['title']) &&
    isText(value['summary']) &&
    Array.isArray(value['entities']) &&
    value['entities'].length > 0 &&
    value['entities'].every(
      (entity: unknown) => isRecord(entity) && isText(entity['term']) && isText(entity['text']),
    ) &&
    isText(value['usage']) &&
    isTextList(value['steps']) &&
    isTextList(value['mistakes']) &&
    isRecord(value['example']) &&
    isText(value['example']['title']) &&
    isText(value['example']['text']) &&
    isRecord(value['operations']) &&
    Object.values(value['operations']).every(isText) &&
    isRecord(value['fields']) &&
    Object.values(value['fields']).every(
      (field: unknown) => isRecord(field) && isText(field['label']) && isText(field['text']),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}

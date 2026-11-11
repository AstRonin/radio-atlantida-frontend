import type { ApiSchema } from '../../core/api/api-types';

/*
 * The rows of the Import page file table: the listing (GET /api/import/files), the probes read
 * when a new file's row is expanded (GET /api/import/file-info), and the artist of the import
 * form, combined into what each row shows, and the sort over those values.
 */

type ImportFile = ApiSchema<'ImportFile'>;
type ImportFileInfo = ApiSchema<'ImportFileInfo'>;
type ImportStatus = ImportFile['status'];

export const SORT_COLUMNS = [
  'path',
  'artist',
  'title',
  'duration',
  'size',
  'modified',
  'status',
] as const;
export type ImportSortColumn = (typeof SORT_COLUMNS)[number];
export interface ImportSort {
  active: ImportSortColumn;
  direction: 'asc' | 'desc';
}

export function isImportSortColumn(value: string): value is ImportSortColumn {
  return (SORT_COLUMNS as readonly string[]).includes(value);
}

/** The probe of a new file (`GET /api/import/file-info`), read when its row is first expanded. */
export type Probe =
  | { status: 'loading' }
  | { status: 'ready'; info: ImportFileInfo }
  | { status: 'error'; message: string };

/**
 * Where a cell's artist or title comes from: the library track, the file's tag, the file name as
 * the probe confirmed (no tag), the listing's file-name guess before a probe, or the import form.
 */
export type CellSource = 'library' | 'tag' | 'file_name' | 'guess' | 'form' | 'none';

/** One table row as shown: the listing, the probe cache, and the form's artist combined. */
export interface FileRow {
  file: ImportFile;
  key: string;
  artist: string | null;
  artistSource: CellSource;
  title: string | null;
  titleSource: CellSource;
  durationMs: number | null;
  /** Every file but `not_audio` has a detail row. */
  expandable: boolean;
  probe: Probe | null;
}

/** A file's identity in the probe cache: a file changed on disk is probed again. */
export function fileKey(file: ImportFile): string {
  return `${file.path}\n${file.size}\n${file.modified_at}`;
}

export function toRow(
  file: ImportFile,
  probe: Probe | undefined,
  formArtist: string | null,
): FileRow {
  const row: FileRow = {
    file,
    key: fileKey(file),
    artist: null,
    artistSource: 'none',
    title: null,
    titleSource: 'none',
    durationMs: null,
    expandable: file.status !== 'not_audio',
    probe: probe ?? null,
  };
  if (file.track) {
    const track = file.track;
    return {
      ...row,
      artist: track.artist,
      artistSource: 'library',
      title: track.title,
      titleSource: 'library',
      durationMs: track.air_duration_ms ?? track.duration_ms,
    };
  }
  if (file.status !== 'new') {
    return row;
  }
  const info = probe?.status === 'ready' ? probe.info : null;
  const fromName = {
    artist: file.name_artist ?? null,
    artistSource: 'guess' as const,
    title: file.name_title ?? null,
    titleSource: 'guess' as const,
  };
  const names = info
    ? {
        artist: info.artist,
        artistSource: info.artist_source,
        title: info.title,
        titleSource: info.title_source,
      }
    : fromName;
  // The artist chosen in the form is set on every new track of the batch.
  const artist =
    formArtist === null ? names : { artist: formArtist, artistSource: 'form' as const };
  return { ...row, ...names, ...artist, durationMs: info?.duration_ms ?? null };
}

// Natural order, so u2 comes before u10, and case does not split the list.
const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Ascending puts first what needs the manager's action: new files, then originals of copies.
const STATUS_RANK: Record<ImportStatus, number> = {
  new: 0,
  original: 1,
  in_library: 2,
  not_audio: 3,
};

const byPath = (a: FileRow, b: FileRow): number => pathCollator.compare(a.file.path, b.file.path);

/** The value a column sorts by: what its cell shows; null for an empty cell. */
const SORT_VALUES: Record<ImportSortColumn, (row: FileRow) => string | number | null> = {
  path: (row) => row.file.path,
  artist: (row) => row.artist || null,
  title: (row) => row.title || null,
  duration: (row) => row.durationMs,
  size: (row) => row.file.size,
  modified: (row) => Date.parse(row.file.modified_at),
  status: (row) => STATUS_RANK[row.file.status],
};

function compareValues(a: string | number, b: string | number): number {
  return typeof a === 'string' && typeof b === 'string'
    ? pathCollator.compare(a, b)
    : Number(a) - Number(b);
}

/**
 * A sorted copy. Empty cells come last in both directions; ties fall back to the path ascending,
 * whatever the direction.
 */
export function sortRows(rows: readonly FileRow[], sort: ImportSort): FileRow[] {
  const value = SORT_VALUES[sort.active];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null || right === null) {
      return left === right ? byPath(a, b) : left === null ? 1 : -1;
    }
    return sign * compareValues(left, right) || byPath(a, b);
  });
}

/** The hint of an artist or title cell, or null when the value needs none. */
export function sourceNote(source: CellSource): string | null {
  switch (source) {
    case 'guess':
      return 'import.folder.fromFileName';
    case 'file_name':
      return 'import.folder.noTag';
    case 'form':
      return 'import.folder.fromForm';
    default:
      return null;
  }
}

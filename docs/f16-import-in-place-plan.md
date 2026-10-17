# Phase F16 Plan — Import in Place (radio-atlantida-frontend)

Status: Done
Based on: backend `docs/phase-18-plan.md` (`GET /api/import/folders`, `GET /api/import/files`, `ImportBody.folder`, no inbox and library folders), `docs/f10-import-plan.md` (import page), `docs/tech-design.md` (§6, §8.7), `CLAUDE.md`
Last updated: 2026-10-16

## 1. Goal

The station's audio lies in folders directly under the media root (`music`, `jingles`, `news`, `music/rock`, ...), without an inbox. On the Import page the manager chooses one of these folders, sees its files and which of them are new, and imports the new ones with a type and optional playlists. The files stay where they are. Importing the same folder later adds only what was copied in since.

## 2. Decisions (2026-10-16)

1. **The page has three parts**, top to bottom: **Folder** (choice and its files), **Import** (type, playlists, button), **Analysis** (unchanged from F10). The "Inbox" section and its texts are removed.
2. **Folder choice.** A control `folder` (the `ImportBody` JSON name) with the folders of `GET /api/import/folders`, in the backend's order:
   - "Whole media folder ({new} new of {total})" for the root, sent as no `folder`;
   - one option per folder, "{path} ({new} new of {total})". Nested folders show their full path (`music/rock`), so no tree widget is needed.

   Nothing is chosen at first, and the control is required: importing a folder is a deliberate choice, because the type applies to all its new files. When `more` is true, a note says that not every folder is listed. The control is a small presentational component `features/import/import-folder-select.component.ts` (`mat-select`; inputs `control`, `folders`, `root`, `more`; label, `app-field-hint`, and field errors as the other form inputs). It stays in `features/import`, because nothing else chooses media folders.
3. **Files of the chosen folder.** An `rxResource` with the folder as params loads `GET /api/import/files?folder=<path>` (no query for the root); changing the folder cancels the request in flight. The table has the columns File, Size, Modified, Status. Status badges:
   - `new`: "New";
   - `in_library`: "In library", linking to the track (`/library/{id}`);
   - `original`: "Original of an optimised copy", linking to the copy's track;
   - `not_audio`: "Not audio".

   The table is paged in the browser (10, 25, 50, or 100 rows per page, 10 at first, the paginator shown above 10 files; `mat-paginator` with translated labels from `shared/ui/paginator-intl.ts`); the backend sends the whole listing (at most 1,000 files) and has no paging. Another folder starts at the first page; a reload keeps the page, or moves back to the last page that still has files (decided 2026-10-16).

   A line above the table shows the folder's counts ("{new} new of {total} audio files"). When the listing has `more`, a note says that not every file is listed. Nothing is chosen: the section asks to choose a folder.
4. **Import form.** Type (`app-playlist-type-select`, required), Playlists (`app-playlist-picker`, optional), as in F10, and a new **Artist** (`app-artist-select` from `shared/pickers`, optional, control `artist_id`). The artist hint says that a chosen artist is set on every new track of the batch, and that without one the artist comes from the file tags, else from the file name. The body is `{ folder?, type_id, playlist_ids, artist_id? }`; the root sends no `folder`, no artist sends no `artist_id`. A new artist is added on the artists page first (the select lists existing artists only).
4a. **Title and artist from the file name** are decided by the backend (backend plan §2.6a), never by the panel: the title is the file name without the folder and the extension; with exactly one hyphen (`-`, `–`, `—`) the part before it is the artist and the part after it the title (`DJ Ann - Morning.mp3` gives `Morning` by `DJ Ann`); with more than one hyphen the name gives no artist. The form intro and the help explain this rule, so the manager can name files to match. Per-field 422 errors land on the controls through `applySubmitError()`, `folder` included; 409 `media_operation_running` and 503 `media_tools_unavailable` stay the form error.
5. **Import button.** Disabled while the form is invalid (no folder or no type), an operation of this page runs, or the chosen folder is known to have `new_files: 0`.
6. **Reloads.** The folders and the files reload on Refresh and on `import.completed` and `import.failed` (also when the import was started elsewhere). The chosen folder stays selected with its new counts. If it is no longer in the reloaded list and `more` is false, the control is cleared and a note says the folder is gone; with `more` it is kept (it may only be past the limit; the backend refuses it if it is gone).
7. **Summary.** `app-operation-status` shows the backend's summary (imported, in library, duplicates, unreadable, skipped, failed), and the F10 link to the library filtered to tracks with issues stays.
8. **Missing files are only shown, never handled.** The page does not look for tracks whose file has gone. They show in the library as before (`file_missing` after an analysis), and the manager edits the track's file path or deletes it there.
9. **Texts.** New intro of the form:

   > "Choose a folder of the media folder. Every new audio file in it, subfolders included, becomes a library track of this type; files already in the library are left as they are. The files are not moved. The type applies to the whole batch, so keep songs, jingles, and news in separate folders. Playlists are optional: leave them empty and add the tracks to playlists later. The artist is the one you choose here; without one it comes from the file tags, else from the file name: 'DJ Ann - Morning.mp3' becomes the track 'Morning' by 'DJ Ann'. A name with more than one hyphen gives no artist. New artists are added to the artist list."

   Keys: `import.folder.*` (title, control label, root option, folder option, more, gone, choose, counts, empty, statuses, columns) replace `import.inbox.*`; `import.form.intro` is rewritten; `import.form.folder` and `import.form.artist_id` are the control labels used in field errors.
10. **Help.** `src/assets/help/en/import.json`: the inbox text goes; a `folder` field entry; a worked example: copy two jingles into `D:\radio\media\jingles`, choose `jingles`, type jingle, Import; later copy a third one and import the folder again, and only the third is added. An `artist_id` field entry and a section on file names: `Artist - Title.mp3` with examples (`DJ Ann - Morning.mp3`, `Jay-Z - Song.mp3` without an artist, `Morning.mp3` without an artist), and the order artist chosen here, then tag, then file name. A note that a moved or deleted file shows as missing in the library.
11. **No client logic about paths or statuses.** The panel shows the folders, paths, counts, and statuses the backend sends and sends one folder back. It never builds or checks a path and never decides whether a file is new.

## 3. Files

| File | Change |
|------|--------|
| `src/app/features/import/import-page.component.ts` | Folder section instead of the inbox; folders and files resources; `folder` control; `canImport` from `new_files`; vanished-folder note; body with `folder` |
| `src/app/features/import/import-folder-select.component.ts` | New, presentational folder select |
| `src/app/features/import/import.spec.ts` | Rewritten for section 4 |
| `src/assets/i18n/en.json` | `import.folder.*`, new `import.form.intro`, `import.form.folder`; `import.inbox.*` removed |
| `src/assets/help/en/import.json` | Rewritten (2.10) |
| `docs/f10-import-plan.md` | A note at the top: the inbox section is replaced by F16 |
| `api/openapi.json`, `src/app/core/api/generated/api.ts` | `npm run api:sync` from the backend phase 18 snapshot |
| `CLAUDE.md` | F16 in the phase list and the required-reading list; F10 description without "inbox" |

The settings page needs no change: the backend no longer sends `import.inbox_dir` and `import.library_dir`, and the page renders what it receives. Its tests that name these keys (if any) are updated.

## 4. Tests

- **Folder select:** the root first with its counts; one option per folder with path and counts, in the given order; the note with `more`; a server error on `folder` under the control; required.
- **Page:**
  - before a choice: no files request, the section asks to choose, the button is disabled;
  - choosing a folder loads `files?folder=<path>`; the root loads without a query; a new choice cancels the request in flight;
  - each status badge, with the track links of `in_library` and `original`;
  - the body has `folder` for a folder and none for the root; type and playlists as in F10; `artist_id` when an artist is chosen and none otherwise; a 422 on `artist_id` lands on the artist control;
  - the button is disabled for `new_files: 0` and enabled for a folder with new files;
  - a 422 with field `folder` lands on the control; 409 and 503 are the form error;
  - after `import.completed` folders and files reload and the folder stays chosen; a folder missing from the reload clears the control with the note, unless `more`;
  - leaving the page cancels the open requests.
- Page tests use `flushHelp()` and `settlePage()` from `core/testing`; the help content test covers the new `folder` field.

## 5. Done when

- With `music` and `jingles` under the media root, the folder control offers "Whole media folder", "jingles (2 new of 2)", "music (3 new of 3)".
- Choosing `jingles` lists its two files as "New"; importing with the type jingle and no playlists makes two tracks with paths `jingles/...`, and the files are still in `D:\radio\media\jingles`.
- After the import the two files show "In library" and the option reads "jingles (0 new of 2)"; the button is disabled.
- A third jingle copied in and Refresh show "1 new"; a second import adds only it.
- `music/DJ Ann - Morning.mp3` without tags shows in the library as `Morning` by `DJ Ann`; importing with an artist chosen gives every new track that artist.
- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.

## 6. Order

Backend phase 18 first, so that `api/openapi.json` carries the new endpoints and drops the inbox. Then this plan; the frontend does not compile against the new snapshot until the inbox section is replaced, which is the point.

## 7. Out of scope

- Following moved files or removing tracks whose file is gone.
- Changing type, playlists, or artist of existing tracks through an import.
- A preview of the title and artist each file would get.
- Creating a new artist from the import form.
- Several folders in one import, a remembered type per folder.
- Creating, renaming, or removing folders.
- Upload through the browser.

# Plan — "Use as Emergency Playlist" Checkbox in the Playlist Form (radio-atlantida-frontend)

Status: Written for the operator's review (2026-11-10); not approved, not started
Based on: `docs/tech-design.md` (§8.6), backend setting `playout.emergency_playlist_id`
Last updated: 2026-11-10

## 1. Goal

Today the emergency playlist is chosen only in **Settings**, far from the playlist itself, and an operator can miss it. The playlist form gets a checkbox with a hint, so it is clear there what the emergency playlist is and which playlist has that role.

The behaviour on air does not change. The checkbox writes the same setting as the **Emergency playlist** field in Settings.

## 2. Decisions

1. **The checkbox and the list marker are frontend only.** The value is written with `PUT /api/settings/playout.emergency_playlist_id`, body `{"value": <id>}`. The refusal to delete comes from the backend (`backend/docs/emergency-playlist-delete-guard-plan.md`), which must be done first; its OpenAPI change reaches this repository with `npm run api:sync`. No other backend change and no new endpoint. If the work turns out to need one, stop and report.
2. **The checkbox is on the create form and on the edit form.** Label: **Use as emergency playlist**.
3. **There is one emergency playlist.** Ticking the box on another playlist replaces the current one.
4. **Settings stays.** The **Emergency playlist** field keeps working and shows the same value.
5. **The setting is written only when the checkbox changed.** Saving an unrelated edit of a playlist never touches the setting.
6. **Warnings do not block saving.**

## 3. Work

### 3.1 Form (`features/playlists/playlist-edit.component.ts`)

- Add the checkbox with `app-field-hint`, the same as other fields of the panel. Requests go through `ApiClient`, errors are shown with `problemMessage()` or `applySubmitError()`, and other playlists' names come through `CatalogService`.
- The page already implements `PendingChanges`: a changed checkbox counts as an unsaved change.
- On open, read the current value of the setting the same way the Settings page does. The box is ticked when the value equals this playlist's ID.
- If reading the setting fails, disable the box with a short message. The rest of the form works, and the setting is not written.

### 3.2 Messages under the checkbox

| State | Message |
|-------|---------|
| Ticked, another playlist is the current one | Names that playlist and says it will be replaced on save |
| Was the current one, now unticked | Says no emergency playlist will be set, and an hour with no plan will air a test tone |
| Ticked, the playlist has no track with a known duration | Says such a playlist will not play. If the form has no duration data for its tracks, warn on an empty track list only, and report this |

### 3.3 Saving

Order: save the playlist and its tracks, then write the setting if the box changed.

- Ticked: the value is the playlist's ID (for a new playlist, the ID returned by the create request).
- Unticked on the current playlist: the same value the Settings page sends for **None**.
- If the playlist save fails, the setting is not written.
- If the setting write fails, the playlist stays saved and the operator sees an error saying the playlist did not become the emergency playlist. A new playlist must then be on its edit page, so saving again does not create a duplicate.

### 3.4 Texts

Add the keys to every language file in `src/assets/i18n/`. English hint:

> Plays automatically when the plan has nothing to air, for example in an hour with no planned tracks. Tracks are picked at random and play rules do not apply. Only one playlist can be the emergency playlist: choosing this one replaces the current one. Applies at once.

If the help page of playlists (`src/assets/help/<lang>/`) or of settings describes the emergency playlist, add the checkbox there too.

### 3.5 Marker in the playlist list

- The row of the current emergency playlist shows a badge **Emergency**, in the same style as the other badges of the list, with a translated label.
- The list reads the setting the same way as the form (§3.1). If reading it fails, the list works without the badge.
- After the setting changes, returning to the list shows the new state.

### 3.6 Refused delete

- The list already shows `used_by` refusals through `ConfirmService`. Add the text for the new reason of the backend plan, saying the playlist is the emergency playlist and that another one must be chosen, or the box unticked, first.
- The delete button stays enabled: the backend is the authority and the refusal explains what to do.

## 4. Tests

- Opens ticked only for the current emergency playlist, unticked for others and for a new playlist.
- Create with the box ticked: playlist first, then the setting with the returned ID.
- Edit with no change of the box: the setting is not written.
- Tick with another current playlist: replacement message, the setting is written.
- Untick on the current playlist: warning, the setting is written with the **None** value.
- Playlist save fails: no setting write.
- Setting write fails: playlist saved, error shown, a new playlist is on its edit page.
- Reading the setting fails: the box is disabled and saving the playlist still works.
- Empty track list: warning shown, saving allowed.
- The list shows the badge only on the current emergency playlist, and none when the setting is empty or cannot be read.
- A delete refused because the playlist is the emergency playlist shows the new text.
- Every language file has the new keys.

## 5. Done when

- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` pass.
- In the running panel: creating a playlist with the box ticked makes it the selected value in **Settings** at once, and changing it in **Settings** is reflected in the form and in the list badge.
- In the running panel: deleting the emergency playlist is refused with the new text.

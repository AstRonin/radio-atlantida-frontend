import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes';
import PlaylistEditComponent from './playlist-edit.component';
import PlaylistsPageComponent from './playlists-page.component';

const routes: Routes = [
  { path: '', component: PlaylistsPageComponent },
  { path: 'new', component: PlaylistEditComponent, canDeactivate: [unsavedChangesGuard] },
  { path: ':id', component: PlaylistEditComponent, canDeactivate: [unsavedChangesGuard] },
];

export default routes;

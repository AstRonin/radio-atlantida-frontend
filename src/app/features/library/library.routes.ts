import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes';
import LibraryPageComponent from './library-page.component';
import TrackEditComponent from './track-edit.component';

const routes: Routes = [
  { path: '', component: LibraryPageComponent },
  { path: 'new', component: TrackEditComponent, canDeactivate: [unsavedChangesGuard] },
  { path: ':id', component: TrackEditComponent, canDeactivate: [unsavedChangesGuard] },
];

export default routes;

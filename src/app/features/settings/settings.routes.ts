import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes';
import SettingsPageComponent from './settings-page.component';

const routes: Routes = [
  { path: '', component: SettingsPageComponent, canDeactivate: [unsavedChangesGuard] },
];

export default routes;

import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes';
import ClockEditComponent from './clock-edit.component';
import ClocksPageComponent from './clocks-page.component';

const routes: Routes = [
  { path: '', component: ClocksPageComponent },
  { path: 'new', component: ClockEditComponent, canDeactivate: [unsavedChangesGuard] },
  { path: ':id', component: ClockEditComponent, canDeactivate: [unsavedChangesGuard] },
];

export default routes;

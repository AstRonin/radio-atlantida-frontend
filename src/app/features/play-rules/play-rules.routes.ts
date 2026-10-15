import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes';
import PlayRuleEditComponent from './play-rule-edit.component';
import PlayRulesPageComponent from './play-rules-page.component';

const routes: Routes = [
  { path: '', component: PlayRulesPageComponent },
  { path: 'new', component: PlayRuleEditComponent, canDeactivate: [unsavedChangesGuard] },
  { path: ':id', component: PlayRuleEditComponent, canDeactivate: [unsavedChangesGuard] },
];

export default routes;

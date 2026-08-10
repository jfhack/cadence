import { Routes } from '@angular/router';

import { AssessmentPage } from './features/assessment/assessment-page';

export const routes: Routes = [
  { path: '', component: AssessmentPage },
  { path: '**', redirectTo: '' },
];

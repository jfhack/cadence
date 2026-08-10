import { Injectable } from '@angular/core';
import { httpResource } from '@angular/common/http';

import { Locale } from './models';

@Injectable({ providedIn: 'root' })
export class LocalesService {
  readonly locales = httpResource<Locale[]>(() => '/api/locales', { defaultValue: [] });
}

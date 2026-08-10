import { HttpInterceptorFn } from '@angular/common/http';

import { apiBase } from './runtime-config';

export const apiBaseInterceptor: HttpInterceptorFn = (request, next) => {
  const base = apiBase();
  if (!base || !request.url.startsWith('/api/')) {
    return next(request);
  }
  return next(request.clone({ url: `${base}${request.url}` }));
};

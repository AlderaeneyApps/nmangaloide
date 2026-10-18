import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { NHENTAI_API_CONFIG } from './api.config';
import { ApiKeyService } from './api-key.service';

/**
 * Adds `Authorization: Key <api key>` (when a key is set) and a descriptive
 * `User-Agent` to requests sent to the nhentai API. Other requests (such as the
 * translation files) pass through untouched.
 */
export const nhentaiInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(NHENTAI_API_CONFIG);
  if (!req.url.startsWith(config.baseUrl)) {
    return next(req);
  }

  const setHeaders: Record<string, string> = {};
  const key = inject(ApiKeyService).key();
  if (key && !req.headers.has('Authorization')) {
    setHeaders['Authorization'] = `Key ${key}`;
  }
  // Browsers refuse to let scripts set User-Agent, so only send it natively, where
  // CapacitorHttp makes the request (see capacitor.config.ts).
  if (Capacitor.isNativePlatform()) {
    setHeaders['User-Agent'] = config.userAgent;
  }

  return next(req.clone({ setHeaders }));
};

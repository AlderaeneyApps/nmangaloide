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
  if (!isApiUrl(req.url, config.baseUrl)) {
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

/**
 * Whether `url` is the API itself or below it. A plain prefix test would also match
 * `https://nhentai.net/api/v2-other/…`, sending the key to an endpoint it isn't meant for.
 */
export function isApiUrl(url: string, baseUrl: string): boolean {
  if (!url.startsWith(baseUrl)) {
    return false;
  }
  const next = url.charAt(baseUrl.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { ApiRootResponse, CdnConfigResponse, ConfigResponse } from './models';

/** API status and site configuration (CDN servers, announcements). */
@Injectable({ providedIn: 'root' })
export class MetaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(NHENTAI_API_CONFIG).baseUrl;

  /** `GET /api/v2` — API version. */
  getRoot(): Observable<ApiRootResponse> {
    return this.http.get<ApiRootResponse>(this.baseUrl);
  }

  /** `GET /api/v2/config` — CDN servers plus the current announcement. */
  getConfig(): Observable<ConfigResponse> {
    return this.http.get<ConfigResponse>(`${this.baseUrl}/config`);
  }

  /** `GET /api/v2/cdn` — image and thumbnail CDN servers. */
  getCdnConfig(): Observable<CdnConfigResponse> {
    return this.http.get<CdnConfigResponse>(`${this.baseUrl}/cdn`);
  }
}

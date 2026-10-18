import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { BlacklistListResponse, BlacklistResponse, BlacklistUpdateRequest } from './models';

/** The user's tag blacklist. Needs an API key. */
@Injectable({ providedIn: 'root' })
export class BlacklistService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/blacklist`;

  /** `GET /blacklist` — blacklisted tags with details. */
  get(): Observable<BlacklistListResponse> {
    return this.http.get<BlacklistListResponse>(this.url);
  }

  /** `GET /blacklist/ids` — just the tag IDs. */
  getIds(): Observable<number[]> {
    return this.http.get<number[]>(`${this.url}/ids`);
  }

  /** `POST /blacklist` — add and/or remove tag IDs. */
  update(changes: BlacklistUpdateRequest): Observable<BlacklistResponse> {
    return this.http.post<BlacklistResponse>(this.url, changes);
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { toParams } from './http-params';
import { PaginatedGalleryListItemResponse } from './models';

/**
 * The user's favorites. Needs an API key. To add or remove one, use
 * `GalleriesService.addFavorite` / `removeFavorite`.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/favorites`;

  /** `GET /favorites` — optionally searching within them. */
  list(page = 1, query?: string): Observable<PaginatedGalleryListItemResponse> {
    return this.http.get<PaginatedGalleryListItemResponse>(this.url, {
      params: toParams({ q: query, page }),
    });
  }

  /** `GET /favorites/random` — a random favorite's ID (the spec leaves the shape untyped). */
  random(): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.url}/random`);
  }
}

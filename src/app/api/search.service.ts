import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { toParams } from './http-params';
import { GallerySort, PaginatedGalleryListItemResponse } from './models';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/search`;

  /**
   * `GET /search`. The query supports keywords, `"exact phrases"`, negation
   * (`-word`), tag filters (`artist:name`, `language:english`), numeric
   * filters (`pages:>10`) and date filters (`uploaded:<7d`).
   */
  search(query: string, sort: GallerySort = 'date', page = 1): Observable<PaginatedGalleryListItemResponse> {
    return this.http.get<PaginatedGalleryListItemResponse>(this.url, {
      params: toParams({ query, sort, page }),
    });
  }
}

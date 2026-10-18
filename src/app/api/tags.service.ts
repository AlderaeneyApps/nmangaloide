import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { toParams } from './http-params';
import { AutocompleteRequest, TagPaginatedResponse, TagResponse, TagSort } from './models';

/** Tag types used by nhentai (the API types this as a plain string). */
export type TagType = 'tag' | 'artist' | 'character' | 'parody' | 'group' | 'language' | 'category';

/** Every tag type, in the order the app shows them. */
export const TAG_TYPES: readonly TagType[] = ['tag', 'artist', 'character', 'parody', 'group', 'language', 'category'];

@Injectable({ providedIn: 'root' })
export class TagsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/tags`;

  /** `GET /tags/ids` — resolve tag IDs (e.g. a gallery's `tag_ids`). */
  getByIds(ids: number[]): Observable<TagResponse[]> {
    return this.http.get<TagResponse[]>(`${this.url}/ids`, {
      params: toParams({ ids: ids.join(',') }),
    });
  }

  /** `POST /tags/search` — autocomplete by prefix. `limit` is 1–50 (default 10). */
  search(request: AutocompleteRequest): Observable<TagResponse[]> {
    return this.http.post<TagResponse[]>(`${this.url}/search`, request);
  }

  /** `GET /tags/{type}` — paginated tags of one type. */
  listByType(
    tagType: TagType | string,
    sort: TagSort = 'popular',
    page = 1,
    perPage = 25,
  ): Observable<TagPaginatedResponse> {
    return this.http.get<TagPaginatedResponse>(`${this.url}/${encodeURIComponent(tagType)}`, {
      params: toParams({ sort, page, per_page: perPage }),
    });
  }

  /** `GET /tags/{type}/{slug}` */
  getBySlug(tagType: TagType | string, slug: string): Observable<TagResponse> {
    return this.http.get<TagResponse>(
      `${this.url}/${encodeURIComponent(tagType)}/${encodeURIComponent(slug)}`,
    );
  }
}

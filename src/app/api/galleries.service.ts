import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { toParams } from './http-params';
import {
  DownloadFormat,
  DownloadResponse,
  FavoriteResponse,
  GalleryDetailResponse,
  GalleryListItem,
  GallerySort,
  PaginatedGalleryListItemResponse,
  RelatedGalleriesResponse,
} from './models';

/** Extra data `get` can embed in the gallery response. */
export type GalleryInclude = 'comments' | 'related' | 'favorite' | 'suggestions';

@Injectable({ providedIn: 'root' })
export class GalleriesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/galleries`;

  /** `GET /galleries` — newest galleries first. `perPage` is 1–100. */
  list(page = 1, perPage = 25): Observable<PaginatedGalleryListItemResponse> {
    return this.http.get<PaginatedGalleryListItemResponse>(this.url, {
      params: toParams({ page, per_page: perPage }),
    });
  }

  /** `GET /galleries/tagged` — galleries with the given tag. */
  listByTag(
    tagId: number,
    sort: GallerySort = 'date',
    page = 1,
    perPage = 25,
  ): Observable<PaginatedGalleryListItemResponse> {
    return this.http.get<PaginatedGalleryListItemResponse>(`${this.url}/tagged`, {
      params: toParams({ tag_id: tagId, sort, page, per_page: perPage }),
    });
  }

  /** `GET /galleries/popular` — currently popular galleries. */
  popular(): Observable<GalleryListItem[]> {
    return this.http.get<GalleryListItem[]>(`${this.url}/popular`);
  }

  /** `GET /galleries/random` — a random gallery ID (the spec leaves the shape untyped). */
  random(): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.url}/random`);
  }

  /** `GET /galleries/{id}` — full gallery details, optionally embedding extra data. */
  get(galleryId: number, include: GalleryInclude[] = []): Observable<GalleryDetailResponse> {
    return this.http.get<GalleryDetailResponse>(`${this.url}/${galleryId}`, {
      params: toParams({ include: include.join(',') }),
    });
  }

  /** `GET /galleries/{id}/related` */
  related(galleryId: number): Observable<RelatedGalleriesResponse> {
    return this.http.get<RelatedGalleriesResponse>(`${this.url}/${galleryId}/related`);
  }

  /** `GET /galleries/{id}/favorite` — whether the user has favorited it. Needs an API key. */
  isFavorite(galleryId: number): Observable<FavoriteResponse> {
    return this.http.get<FavoriteResponse>(`${this.url}/${galleryId}/favorite`);
  }

  /** `POST /galleries/{id}/favorite` — needs an API key. */
  addFavorite(galleryId: number): Observable<FavoriteResponse> {
    return this.http.post<FavoriteResponse>(`${this.url}/${galleryId}/favorite`, null);
  }

  /** `DELETE /galleries/{id}/favorite` — needs an API key. */
  removeFavorite(galleryId: number): Observable<FavoriteResponse> {
    return this.http.delete<FavoriteResponse>(`${this.url}/${galleryId}/favorite`);
  }

  /**
   * `POST /galleries/{id}/download` — a short-lived download URL. Fetch it
   * before `expires_at` (unix seconds). Needs an API key.
   */
  getDownloadUrl(galleryId: number, format: DownloadFormat = 'zip'): Observable<DownloadResponse> {
    return this.http.post<DownloadResponse>(`${this.url}/${galleryId}/download`, null, {
      params: toParams({ format }),
    });
  }
}

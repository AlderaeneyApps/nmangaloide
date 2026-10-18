import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { toParams } from './http-params';
import { PaginatedCommentResponse } from './models';

/**
 * Read-only: posting, deleting and flagging comments need a logged-in user
 * token plus proof-of-work and CAPTCHA, which API keys can't do.
 */
@Injectable({ providedIn: 'root' })
export class CommentsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/galleries`;

  /** `GET /galleries/{id}/comments` — `perPage` is 1–50. */
  list(galleryId: number, page = 1, perPage = 50): Observable<PaginatedCommentResponse> {
    return this.http.get<PaginatedCommentResponse>(`${this.url}/${galleryId}/comments`, {
      params: toParams({ page, per_page: perPage }),
    });
  }

  /** `GET /galleries/{id}/comments/count` */
  count(galleryId: number): Observable<number> {
    return this.http.get<number>(`${this.url}/${galleryId}/comments/count`);
  }
}

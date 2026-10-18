import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NHENTAI_API_CONFIG } from './api.config';
import { UserMeResponse } from './models';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(NHENTAI_API_CONFIG).baseUrl}/user`;

  /** `GET /user` — the account the API key belongs to. Handy for checking a key. */
  getMe(): Observable<UserMeResponse> {
    return this.http.get<UserMeResponse>(this.url);
  }
}

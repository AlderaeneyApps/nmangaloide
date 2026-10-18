import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { GalleriesService, GalleryDetailResponse } from '../api';
import { SavedGalleriesService } from './saved-galleries.service';

/** How many galleries to keep, so going back and forth doesn't refetch them. */
const CACHE_SIZE = 20;

/**
 * Gallery details for the detail page and the reader. Galleries saved on the
 * device (favorites) come from the database, so they cost no API calls; others
 * are fetched once and shared.
 */
@Injectable({ providedIn: 'root' })
export class GalleryDetailsService {
  private readonly galleries = inject(GalleriesService);
  private readonly saved = inject(SavedGalleriesService);
  private readonly cache = new Map<number, Promise<GalleryDetailResponse>>();

  get(id: number): Promise<GalleryDetailResponse> {
    const cached = this.cache.get(id);
    if (cached) {
      // Move to the end, so the least recently used gallery is evicted first.
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    const request = this.fromDevice(id).then((saved) => saved ?? firstValueFrom(this.galleries.get(id)));
    this.cache.set(id, request);
    // Failed requests aren't cached, so retrying fetches again.
    request.catch(() => this.cache.delete(id));
    while (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return request;
  }

  private fromDevice(id: number): Promise<GalleryDetailResponse | null> {
    return this.saved.getDetails(id).catch(() => null);
  }
}

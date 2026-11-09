import { Injectable, signal } from '@angular/core';

import { GallerySort } from '../api';

/** The order of the home page's results, kept here so it outlives any one search. */
@Injectable({ providedIn: 'root' })
export class GallerySortService {
  readonly sort = signal<GallerySort>('date');
}

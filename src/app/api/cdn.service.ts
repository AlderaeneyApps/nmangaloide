import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { MetaService } from './meta.service';
import { CdnConfigResponse } from './models';

/**
 * Turns the image paths returned by the API into full URLs.
 *
 * The spec doesn't document the path format, so both shapes are handled:
 * absolute URLs are used as-is, and relative paths are joined to one of the
 * CDN servers from `GET /cdn` (fetched once and cached).
 */
@Injectable({ providedIn: 'root' })
export class CdnService {
  private readonly meta = inject(MetaService);
  private readonly _config = signal<CdnConfigResponse | null>(null);
  private loading: Promise<void> | null = null;

  readonly config = this._config.asReadonly();

  /** Fetches the CDN servers once. Safe to call repeatedly; failures can be retried. */
  load(): Promise<void> {
    this.loading ??= firstValueFrom(this.meta.getCdnConfig()).then(
      (config) => this._config.set(config),
      (error) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }

  /** Full URL for a thumbnail path, or null while the CDN servers aren't known. */
  thumbnailUrl(path: string | null | undefined): string | null {
    return resolveMediaUrl(path, this._config()?.thumb_servers);
  }

  /** Full URL for a full-size page image path, or null while the CDN servers aren't known. */
  imageUrl(path: string | null | undefined): string | null {
    return resolveMediaUrl(path, this._config()?.image_servers);
  }
}

export function resolveMediaUrl(path: string | null | undefined, servers: string[] | undefined): string | null {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith('//')) {
    return `https:${path}`;
  }
  const server = servers?.[0];
  if (!server) {
    return null;
  }
  const base = /^https?:\/\//i.test(server) ? server : `https://${server}`;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

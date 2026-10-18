import { Injectable, computed, signal } from '@angular/core';

/**
 * Holds the user's nhentai API key (generated at
 * https://nhentai.net/user/settings#apikeys). Endpoints that need an account
 * (favorites, blacklist, downloads, current user) fail with 401 until it is set.
 *
 * The key only lives in memory; persist it (e.g. in the SQLite store) and call
 * `set` on startup.
 */
@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private readonly _key = signal<string | null>(null);

  readonly key = this._key.asReadonly();
  readonly hasKey = computed(() => !!this._key());

  set(key: string | null): void {
    const trimmed = key?.trim();
    this._key.set(trimmed ? trimmed : null);
  }

  clear(): void {
    this._key.set(null);
  }
}

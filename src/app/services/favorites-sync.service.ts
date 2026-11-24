import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, Injector, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiKeyService } from '../api/api-key.service';
import { FavoritesService } from '../api/favorites.service';
import { GalleriesService } from '../api/galleries.service';
import { APP_ACTIVE_LISTENER } from '../native/download-keep-alive';
import { AppSettingsService } from './app-settings.service';
import { GalleryDetailsService } from './gallery-details.service';
import { SavedGalleriesService } from './saved-galleries.service';

/** At most this many API requests per minute: `GET /favorites` pages and changes together. */
export const FAVORITES_SYNC_PER_MINUTE = 15;

/** Milliseconds between two API requests of the sync; a token so specs can shorten it. */
export const FAVORITES_SYNC_INTERVAL = new InjectionToken<number>('FAVORITES_SYNC_INTERVAL', {
  providedIn: 'root',
  factory: () => 60_000 / FAVORITES_SYNC_PER_MINUTE,
});

/** Coming back to the app syncs again if the last sync started at least this long ago. */
export const FAVORITES_RESYNC_AFTER = 15 * 60_000;

/** How long to wait after the API answers 429 (too many requests) before trying again. */
const RATE_LIMITED_WAIT = 60_000;
/**
 * Safety cap on `GET /favorites` pages, in case the API keeps reporting more; a token so
 * specs can lower it. Going past it fails the sync: acting on a partial list would take the
 * favorites not read for ones removed on the account, and delete them from the device.
 */
export const FAVORITES_MAX_PAGES = new InjectionToken<number>('FAVORITES_MAX_PAGES', {
  providedIn: 'root',
  factory: () => 500,
});
/** `app_settings` row holding the favorites both sides had at the last sync. */
const SYNCED_KEY = 'favorites_synced';

export type FavoritesSyncState = 'idle' | 'checking' | 'syncing' | 'done' | 'error';

export interface FavoritesSyncStatus {
  state: FavoritesSyncState;
  /** Changes still waiting in the queue. */
  pending: number;
  /** Changes made in this run. */
  completed: number;
  /** Changes that failed in this run (skipped; the next sync tries again). */
  failed: number;
}

/**
 * A queued change, each costing one API request:
 * - `push-add` / `push-remove`: add or remove the favorite on the account;
 * - `pull-add`: fetch the details of a favorite made on the account and save it on the device.
 */
export interface FavoriteChange {
  kind: 'push-add' | 'push-remove' | 'pull-add';
  id: number;
}

interface SyncedRecord {
  /** Which account (a hash of its API key) the IDs belong to. */
  account: string;
  ids: number[];
}

const IDLE: FavoritesSyncStatus = { state: 'idle', pending: 0, completed: 0, failed: 0 };

/** Thrown to stop a run that was replaced by a newer one (key changed or removed). */
class Cancelled extends Error {}

/**
 * Keeps the device's favorites and the nhentai account's favorites the same.
 *
 * A sync reads every page of `GET /favorites` and compares it with the device and
 * with the favorites both sides had at the end of the last sync (kept in
 * `app_settings`), which tells a new favorite from a removed one:
 *
 * | on the device | on the account | at the last sync | so it was…                 | change              |
 * |---------------|----------------|------------------|----------------------------|---------------------|
 * | yes           | no             | no               | favorited on the device    | add to the account  |
 * | yes           | no             | yes              | removed on the account     | remove from device  |
 * | no            | yes            | no               | favorited on the account   | add to the device   |
 * | no            | yes            | yes              | removed on the device      | remove from account |
 *
 * The first sync with an account only merges both lists, so nothing is removed. A favorite
 * that seems removed on the account is checked on its own first (`GET /galleries/{id}/favorite`):
 * the pages can shift while they're read, if favorites change on the website meanwhile.
 * Removing from the device needs no request and happens at once; every other change
 * is queued and sent in the background. Every request (reading the account's pages
 * too) is spaced out to at most 15 per minute. Favoriting or
 * removing a gallery on the device later goes through the same queue
 * (`addToAccount` / `removeFromAccount`).
 *
 * Syncs run when an API key is set (at startup, or when it's changed in Settings),
 * and again when the app comes back to the foreground after a while. Changing or
 * removing the key stops the run in progress; a different key is another account,
 * so its first sync only merges again.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesSyncService {
  private readonly apiKeys = inject(ApiKeyService);
  private readonly remote = inject(FavoritesService);
  private readonly galleries = inject(GalleriesService);
  private readonly details = inject(GalleryDetailsService);
  private readonly saved = inject(SavedGalleriesService);
  private readonly settings = inject(AppSettingsService);
  private readonly interval = inject(FAVORITES_SYNC_INTERVAL);
  private readonly maxPages = inject(FAVORITES_MAX_PAGES);
  private readonly onAppActive = inject(APP_ACTIVE_LISTENER);
  private readonly injector = inject(Injector);

  private readonly _status = signal<FavoritesSyncStatus>(IDLE);
  readonly status = this._status.asReadonly();

  /** Bumped by every new run; an older run sees the change and stops. */
  private run = 0;
  /** Ends every pause in progress, so a replaced run notices at once (see `pause`). */
  private readonly waiters = new Set<() => void>();
  private started = false;
  /** Changes waiting to be sent, next first. */
  private queue: FavoriteChange[] = [];
  /** The run whose drain is sending the queue, if any. */
  private draining: number | null = null;
  /** When the last request was sent (ms), for the rate limit. */
  private lastRequestAt = -Infinity;
  /** When the last sync started (ms), to decide whether coming back syncs again. */
  private lastSyncAt = -Infinity;
  /** Favorites both sides had at the last sync, for the current account (loaded by `sync`). */
  private synced: { account: string; ids: Set<number> } | null = null;

  /** Syncs whenever an API key is set, and when the app comes back after a while. Call once at startup. */
  init(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    effect(
      () => {
        const key = this.apiKeys.key();
        untracked(() => (key ? void this.sync() : this.stop()));
      },
      { injector: this.injector },
    );
    this.onAppActive((active) => {
      const busy = ['checking', 'syncing'].includes(this._status().state);
      if (active && !busy && this.apiKeys.hasKey() && Date.now() - this.lastSyncAt >= FAVORITES_RESYNC_AFTER) {
        void this.sync();
      }
    });
  }

  /**
   * Runs a sync now, replacing any run in progress. Resolves when every change was
   * sent (or the run was replaced); never rejects. The outcome is in `status`.
   */
  async sync(): Promise<void> {
    const run = this.restart();
    if (!this.apiKeys.hasKey()) {
      this._status.set(IDLE);
      return;
    }
    this.lastSyncAt = Date.now();
    try {
      this._status.set({ ...IDLE, state: 'checking' });
      await this.saved.load();
      const synced = await this.loadSynced(run);
      const remoteIds = await this.remoteFavoriteIds(run);
      const changes = await this.plan(run, remoteIds, synced);
      // Changes the user made while the account was being read come after, and win.
      const later = this.queue;
      this.queue = [...changes.filter((change) => !later.some((other) => other.id === change.id)), ...later];
      this._status.set({ state: 'syncing', pending: this.queue.length, completed: 0, failed: 0 });
      await this.drain(run);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Stops the run in progress, if any. */
  stop(): void {
    this.restart();
    this._status.set(IDLE);
  }

  /** Starts a sync over (e.g. after a backup replaced the favorites), or stops without an API key. */
  resync(): void {
    if (this.apiKeys.hasKey()) {
      void this.sync();
    } else {
      this.stop();
    }
  }

  /** Queues a gallery just favorited on the device to be added to the account. */
  addToAccount(id: number): Promise<void> {
    return this.change({ kind: 'push-add', id });
  }

  /** Queues a gallery just removed from the device's favorites to be removed from the account. */
  removeFromAccount(id: number): Promise<void> {
    return this.change({ kind: 'push-remove', id });
  }

  /**
   * Queues a change made on the device, replacing any change still waiting for the
   * same gallery. Does nothing without an API key. Never rejects.
   */
  private async change(change: FavoriteChange): Promise<void> {
    if (!this.apiKeys.hasKey()) {
      return;
    }
    this.queue = [...this.queue.filter((other) => other.id !== change.id), change];
    const status = this._status();
    if (status.state === 'checking') {
      // The sync in progress sends it once it knows what else to change.
      return;
    }
    this._status.set(
      status.state === 'syncing'
        ? { ...status, pending: this.queue.length }
        : { state: 'syncing', pending: this.queue.length, completed: 0, failed: 0 },
    );
    try {
      await this.drain(this.run);
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (!(error instanceof Cancelled)) {
      this._status.update((status) => ({ ...status, state: 'error' }));
    }
  }

  private restart(): number {
    this.run++;
    this.queue = [];
    for (const wake of [...this.waiters]) {
      wake();
    }
    return this.run;
  }

  private async remoteFavoriteIds(run: number): Promise<Set<number>> {
    const ids = new Set<number>();
    for (let page = 1, pages = 1; page <= pages; page++) {
      if (page > this.maxPages) {
        throw new Error(`More than ${this.maxPages} pages of favorites on the account`);
      }
      const response = await this.request(run, () => firstValueFrom(this.remote.list(page)));
      for (const item of response.result ?? []) {
        ids.add(item.id);
      }
      pages = response.num_pages ?? 1;
    }
    return ids;
  }

  /**
   * Works out the changes (see the table above). Removes from the device straight
   * away; returns the rest, oldest device favorites first.
   */
  private async plan(run: number, remoteIds: Set<number>, synced: Set<number>): Promise<FavoriteChange[]> {
    // Oldest first, so the account gets them in the order they were favorited here.
    const localIds = this.saved
      .favorites()
      .map((gallery) => gallery.id)
      .reverse();
    const local = new Set(localIds);
    const changes: FavoriteChange[] = [];
    const removedRemotely: number[] = [];

    for (const id of localIds) {
      if (remoteIds.has(id)) {
        synced.add(id);
      } else if (synced.has(id)) {
        removedRemotely.push(id);
      } else {
        changes.push({ kind: 'push-add', id });
      }
    }
    // The account lists newest first; add them to the device oldest first.
    for (const id of [...remoteIds].reverse()) {
      if (local.has(id)) {
        continue;
      }
      changes.push({ kind: synced.has(id) ? 'push-remove' : 'pull-add', id });
    }
    for (const id of [...synced]) {
      if (!local.has(id) && !remoteIds.has(id)) {
        synced.delete(id);
      }
    }

    for (const id of removedRemotely) {
      if (await this.stillOnAccount(run, id)) {
        // Missed while reading: the account's pages shifted (a favorite was added or removed
        // on the website meanwhile). Both sides still have it.
        continue;
      }
      await this.saved.removeFavorite(id);
      this.check(run);
      synced.delete(id);
    }
    await this.saveSynced();
    this.check(run);
    return changes;
  }

  /**
   * Asks the account about one favorite before it's removed from the device, as the pages
   * read can miss one. A gallery the site no longer has (404) isn't a favorite any more.
   */
  private async stillOnAccount(run: number, id: number): Promise<boolean> {
    try {
      const { favorited } = await this.request(run, () => firstValueFrom(this.galleries.isFavorite(id)));
      return favorited;
    } catch (error) {
      this.check(run);
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /** Sends the queued changes one by one, within the rate limit. One drain at a time. */
  private async drain(run: number): Promise<void> {
    if (this.draining === run) {
      return;
    }
    this.draining = run;
    try {
      while (this.queue.length) {
        const change = this.queue[0];
        const ok = await this.apply(run, change);
        // A replaced run stops here: the queue (and the status) now belong to the newer run.
        this.check(run);
        // A newer change for the same gallery may have replaced it meanwhile.
        this.queue = this.queue.filter((other) => other !== change);
        this._status.update((status) => ({
          ...status,
          pending: this.queue.length,
          completed: status.completed + (ok ? 1 : 0),
          failed: status.failed + (ok ? 0 : 1),
        }));
      }
      this._status.update((status) => ({ ...status, state: 'done' }));
    } finally {
      if (this.draining === run) {
        this.draining = null;
      }
    }
  }

  /** Makes one change; resolves false if it was skipped. Stops the run when the key is refused. */
  private async apply(run: number, change: FavoriteChange): Promise<boolean> {
    try {
      await this.request(run, () => this.send(change));
      await this.recordSynced(change);
      return true;
    } catch (error) {
      this.check(run);
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (status === 401 || status === 403) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Sends one API request within the rate limit shared by every request of the sync
   * (`GET /favorites` pages and changes alike): waits until the interval since the
   * previous one has passed, and retries once a minute later if the API answers 429.
   */
  private async request<T>(run: number, send: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.interval - Date.now();
      if (wait > 0) {
        await this.pause(run, wait);
      }
      this.check(run);
      this.lastRequestAt = Date.now();
      try {
        const result = await send();
        this.check(run);
        return result;
      } catch (error) {
        this.check(run);
        if (error instanceof HttpErrorResponse && error.status === 429 && attempt === 0) {
          await this.pause(run, RATE_LIMITED_WAIT);
          continue;
        }
        throw error;
      }
    }
  }

  private async send({ kind, id }: FavoriteChange): Promise<void> {
    switch (kind) {
      case 'push-add':
        await firstValueFrom(this.galleries.addFavorite(id));
        return;
      case 'push-remove':
        await firstValueFrom(this.galleries.removeFavorite(id));
        return;
      case 'pull-add':
        if (!this.saved.isFavorite(id)) {
          await this.saved.addFavorite(await this.details.get(id));
        }
        return;
    }
  }

  /** After a change, both sides have the favorite (adds) or neither has it (removes). */
  private async recordSynced({ kind, id }: FavoriteChange): Promise<void> {
    if (!this.synced) {
      return;
    }
    if (kind === 'push-remove') {
      this.synced.ids.delete(id);
    } else {
      this.synced.ids.add(id);
    }
    await this.saveSynced().catch(() => undefined);
  }

  /** The favorites both sides had at the last sync with this account (none for another account). */
  private async loadSynced(run: number): Promise<Set<number>> {
    const account = accountOf(this.apiKeys.key() ?? '');
    const value = await this.settings.getValue(SYNCED_KEY);
    this.check(run);
    let ids: number[] = [];
    try {
      const record = JSON.parse(value ?? 'null') as Partial<SyncedRecord> | null;
      if (record?.account === account && Array.isArray(record.ids)) {
        ids = record.ids.filter((id) => Number.isInteger(id));
      }
    } catch {
      // Unreadable: treat it as a first sync, which only merges.
    }
    this.synced = { account, ids: new Set(ids) };
    return this.synced.ids;
  }

  private saveSynced(): Promise<void> {
    if (!this.synced) {
      return Promise.resolve();
    }
    const record: SyncedRecord = { account: this.synced.account, ids: [...this.synced.ids] };
    return this.settings.setValue(SYNCED_KEY, JSON.stringify(record));
  }

  /** Waits, unless a newer run starts first (then throws Cancelled). */
  private async pause(run: number, ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.waiters.add(wake);
    });
    this.check(run);
  }

  private check(run: number): void {
    if (run !== this.run) {
      throw new Cancelled();
    }
  }
}

/** A short, stable fingerprint of the API key, so the key itself isn't stored twice. */
export function accountOf(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

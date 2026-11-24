import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiKeyService } from '../api/api-key.service';
import { GalleryDetailResponse, GalleryListItem, PaginatedGalleryListItemResponse } from '../api/models';
import { nhentaiInterceptor } from '../api/nhentai.interceptor';
import { APP_ACTIVE_LISTENER } from '../native/download-keep-alive';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { AppSettingsService } from './app-settings.service';
import {
  FAVORITES_MAX_PAGES,
  FAVORITES_RESYNC_AFTER,
  FAVORITES_SYNC_INTERVAL,
  FAVORITES_SYNC_PER_MINUTE,
  FavoritesSyncService,
  accountOf,
} from './favorites-sync.service';
import { GalleryDetailsService } from './gallery-details.service';
import { SavedGalleriesService } from './saved-galleries.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const API = 'https://nhentai.net/api/v2';
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function page(ids: number[], numPages = 1): PaginatedGalleryListItemResponse {
  return { result: ids.map((id) => ({ id }) as GalleryListItem), num_pages: numPages, per_page: 25 };
}

describe('FavoritesSyncService', () => {
  let db: FakeDatabase;
  let http: HttpTestingController;
  let keys: ApiKeyService;
  let sync: FavoritesSyncService;
  let saved: SavedGalleriesService;
  let pulled: number[];
  let setActive: (active: boolean) => void;

  function setup(interval = 5, maxPages = 500) {
    TestBed.resetTestingModule();
    db = new FakeDatabase();
    pulled = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([nhentaiInterceptor])),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        { provide: FAVORITES_SYNC_INTERVAL, useValue: interval },
        { provide: FAVORITES_MAX_PAGES, useValue: maxPages },
        { provide: APP_ACTIVE_LISTENER, useValue: (listener: (active: boolean) => void) => (setActive = listener) },
        // Fetching a favorite made on the account: the details, without the cover download.
        {
          provide: GalleryDetailsService,
          useValue: { get: async (id: number) => ({ id }) as GalleryDetailResponse },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    keys = TestBed.inject(ApiKeyService);
    sync = TestBed.inject(FavoritesSyncService);
    saved = TestBed.inject(SavedGalleriesService);
    vi.spyOn(saved, 'addFavorite').mockImplementation(async (gallery) => {
      pulled.push(gallery.id);
      db.seedSaved({ id: gallery.id, favorited_at: Date.now() });
    });
  }

  /** Seeds device favorites, newest first. */
  function seedLocal(...ids: number[]) {
    ids.forEach((id, i) => db.seedSaved({ id, favorited_at: 1000 - i }));
  }

  function seedSynced(ids: number[], key = 'secret') {
    db.settings.set('favorites_synced', JSON.stringify({ account: accountOf(key), ids }));
  }

  const syncedIds = () => (JSON.parse(db.settings.get('favorites_synced')!) as { ids: number[] }).ids.sort((a, b) => a - b);
  const localIds = () =>
    [...db.saved.values()]
      .filter((row) => row['is_favorite'] === 1)
      .map((row) => row['id'] as number)
      .sort((a, b) => a - b);

  beforeEach(() => setup());

  afterEach(() => http.verify());

  async function expectList(pageNumber: number, response: PaginatedGalleryListItemResponse, key = 'secret') {
    let req: TestRequest | undefined;
    for (let i = 0; i < 50 && !req; i++) {
      await settle(i ? 2 : 0);
      req = http.match(`${API}/favorites?page=${pageNumber}`)[0];
    }
    expect(req, `GET /favorites page ${pageNumber}`).toBeDefined();
    expect(req!.request.headers.get('Authorization')).toBe(`Key ${key}`);
    req!.flush(response);
  }

  async function expectRequest(method: 'POST' | 'DELETE', id: number, flush: (req: TestRequest) => void = (r) => r.flush({})) {
    let req: TestRequest | undefined;
    for (let i = 0; i < 50 && !req; i++) {
      await settle(2);
      req = http.match({ method, url: `${API}/galleries/${id}/favorite` })[0];
    }
    expect(req, `${method} for ${id}`).toBeDefined();
    flush(req!);
  }

  async function expectFavoriteCheck(id: number, favorited: boolean | 404) {
    let req: TestRequest | undefined;
    for (let i = 0; i < 50 && !req; i++) {
      await settle(2);
      req = http.match({ method: 'GET', url: `${API}/galleries/${id}/favorite` })[0];
    }
    expect(req, `GET favorite ${id}`).toBeDefined();
    if (favorited === 404) {
      req!.flush('gone', { status: 404, statusText: 'Not Found' });
    } else {
      req!.flush({ favorited });
    }
  }

  it('sends at most 15 requests per minute', () => {
    expect(FAVORITES_SYNC_PER_MINUTE).toBe(15);
    TestBed.resetTestingModule();
    expect(TestBed.inject(FAVORITES_SYNC_INTERVAL)).toBe(4000);
  });

  it('does nothing without an API key', async () => {
    await sync.sync();
    expect(sync.status().state).toBe('idle');
    http.expectNone(() => true);
  });

  it('merges both lists on the first sync with an account, reading every page', async () => {
    keys.set('secret');
    seedLocal(1, 2, 3);
    const done = sync.sync();
    await expectList(1, page([9, 2], 2));
    await expectList(2, page([8]));

    // Device-only favorites go up oldest first, then account-only ones come down oldest first.
    await expectRequest('POST', 3);
    await expectRequest('POST', 1);
    await done;

    expect(pulled).toEqual([8, 9]);
    expect(localIds()).toEqual([1, 2, 3, 8, 9]);
    expect(syncedIds()).toEqual([1, 2, 3, 8, 9]);
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 4, failed: 0 });
    http.expectNone({ method: 'DELETE' });
  });

  it('tells new favorites from removed ones using the last sync', async () => {
    keys.set('secret');
    seedLocal(1, 2, 3, 6);
    // At the last sync both sides had 1, 2, 3 and 4.
    seedSynced([1, 2, 3, 4]);
    const done = sync.sync();
    await expectList(1, page([2, 4, 5]));
    // 1 and 3 look removed on the account: each is confirmed before it goes from the device.
    await expectFavoriteCheck(3, false);
    await expectFavoriteCheck(1, false);

    // 4 was removed on the device: remove it from the account.
    await expectRequest('POST', 6);
    await expectRequest('DELETE', 4);
    await done;

    // 1 and 3 were removed on the account: gone from the device. 5 is new there: pulled. 6 is new here: pushed.
    expect(localIds()).toEqual([2, 5, 6]);
    expect(pulled).toEqual([5]);
    expect(syncedIds()).toEqual([2, 5, 6]);
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 3, failed: 0 });
  });

  it('only merges when the last sync was with another account', async () => {
    keys.set('secret');
    seedLocal(1);
    seedSynced([1, 4], 'someone else');
    const done = sync.sync();
    await expectList(1, page([4]));
    await expectRequest('POST', 1);
    await done;
    expect(localIds()).toEqual([1, 4]);
    http.expectNone({ method: 'DELETE' });
  });

  it('is done straight away when both sides match', async () => {
    keys.set('secret');
    seedLocal(1, 2);
    const done = sync.sync();
    await expectList(1, page([1, 2]));
    await done;
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 0, failed: 0 });
    expect(syncedIds()).toEqual([1, 2]);
  });

  it('waits the interval between requests, including after a sync', async () => {
    setup(200);
    keys.set('secret');
    seedLocal(1, 2);
    const done = sync.sync();
    await expectList(1, page([]));
    // The first change also waits out the gap after the page read.
    await settle(250);
    http.expectOne({ method: 'POST', url: `${API}/galleries/2/favorite` }).flush({});
    await settle(50);
    http.expectNone({ method: 'POST', url: `${API}/galleries/1/favorite` });
    await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${API}/galleries/1/favorite` }).flush({}), {
      timeout: 400,
      interval: 2,
    });
    await done;

    // Answered at once, so the next request is still a full gap away.
    void sync.removeFromAccount(1);
    await settle(10);
    http.expectNone({ method: 'DELETE' });
    await settle(250);
    http.expectOne({ method: 'DELETE', url: `${API}/galleries/1/favorite` }).flush({});
  });

  it('spaces out the reads of the account the same way, and the first change after them', async () => {
    setup(200);
    keys.set('secret');
    seedLocal(1);
    const done = sync.sync();
    await settle();
    http.expectOne(`${API}/favorites?page=1`).flush(page([], 2));
    await settle(50);
    http.expectNone(`${API}/favorites?page=2`);
    await settle(250);
    http.expectOne(`${API}/favorites?page=2`).flush(page([]));
    await settle(50);
    http.expectNone({ method: 'POST' });
    await settle(250);
    http.expectOne({ method: 'POST', url: `${API}/galleries/1/favorite` }).flush({});
    await done;
  });

  it('retries a page a minute later when the API asks to slow down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      keys.set('secret');
      const done = sync.sync();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(`${API}/favorites?page=1`).flush('slow down', { status: 429, statusText: 'Too Many Requests' });
      await vi.advanceTimersByTimeAsync(59_000);
      http.expectNone(`${API}/favorites?page=1`);
      // The minute, plus the usual gap between requests.
      await vi.advanceTimersByTimeAsync(1_010);
      http.expectOne(`${API}/favorites?page=1`).flush(page([]));
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(sync.status().state).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a change that fails, so the next sync tries it again', async () => {
    keys.set('secret');
    seedLocal(1, 3);
    const done = sync.sync();
    await expectList(1, page([]));
    await expectRequest('POST', 3, (req) => req.flush('nope', { status: 500, statusText: 'Server Error' }));
    await expectRequest('POST', 1);
    await done;
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 1, failed: 1 });
    expect(syncedIds()).toEqual([1]);
  });

  it('stops when the key is refused', async () => {
    keys.set('secret');
    seedLocal(1, 3);
    const done = sync.sync();
    await expectList(1, page([]));
    await expectRequest('POST', 3, (req) => req.flush('no', { status: 401, statusText: 'Unauthorized' }));
    await done;
    expect(sync.status().state).toBe('error');
    await settle(20);
    http.expectNone({ method: 'POST' });
  });

  it('changes nothing when the account cannot be read', async () => {
    keys.set('secret');
    seedLocal(1);
    seedSynced([1]);
    const done = sync.sync();
    await settle();
    http.expectOne(`${API}/favorites?page=1`).flush('down', { status: 500, statusText: 'Server Error' });
    await done;
    expect(sync.status().state).toBe('error');
    expect(localIds()).toEqual([1]);
  });

  it('fails instead of removing device favorites when the account has more pages than it reads', async () => {
    setup(5, 2);
    keys.set('secret');
    seedLocal(1, 2);
    // Both were on both sides at the last sync; 1 is only on page 3, which is never read.
    seedSynced([1, 2]);
    const done = sync.sync();
    await expectList(1, page([2], 3));
    await expectList(2, page([], 3));
    await done;
    expect(sync.status().state).toBe('error');
    expect(localIds()).toEqual([1, 2]);
    http.expectNone(`${API}/favorites?page=3`);
  });

  it('keeps a favorite the account pages missed (they shifted while being read)', async () => {
    keys.set('secret');
    seedLocal(1, 2);
    seedSynced([1, 2]);
    const done = sync.sync();
    await expectList(1, page([2]));
    await expectFavoriteCheck(1, true);
    await done;
    expect(localIds()).toEqual([1, 2]);
    expect(syncedIds()).toEqual([1, 2]);
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 0, failed: 0 });
  });

  it('removes a favorite whose gallery the site no longer has', async () => {
    keys.set('secret');
    seedLocal(1, 2);
    seedSynced([1, 2]);
    const done = sync.sync();
    await expectList(1, page([2]));
    await expectFavoriteCheck(1, 404);
    await done;
    expect(localIds()).toEqual([2]);
  });

  it('removes nothing when a removal cannot be confirmed', async () => {
    keys.set('secret');
    seedLocal(1, 2);
    seedSynced([1, 2]);
    const done = sync.sync();
    await expectList(1, page([2]));
    await vi.waitFor(() =>
      http
        .expectOne({ method: 'GET', url: `${API}/galleries/1/favorite` })
        .flush('down', { status: 500, statusText: 'Server Error' }),
    );
    await done;
    expect(sync.status().state).toBe('error');
    expect(localIds()).toEqual([1, 2]);
  });

  it('a replaced run leaves the queue and the counts to the new one', async () => {
    keys.set('secret');
    seedLocal(1, 3);
    const settings = TestBed.inject(AppSettingsService);
    const setValue = settings.setValue.bind(settings);
    let replaceDuringSave = false;
    vi.spyOn(settings, 'setValue').mockImplementation(async (key, value) => {
      await setValue(key, value);
      if (replaceDuringSave) {
        // The first run is saving its progress when it's replaced and a change is queued.
        replaceDuringSave = false;
        sync.stop();
        void sync.addToAccount(7);
      }
    });
    const first = sync.sync();
    await expectList(1, page([]));
    await expectRequest('POST', 3, (req) => {
      replaceDuringSave = true;
      req.flush({});
    });
    await first;

    await expectRequest('POST', 7);
    await vi.waitFor(() => expect(sync.status().state).toBe('done'));
    expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 1, failed: 0 });
    // The first run's other change was dropped with it, not sent.
    await settle(20);
    http.expectNone({ method: 'POST', url: `${API}/galleries/1/favorite` });
  });

  describe('changes made on the device', () => {
    it('do nothing without an API key', async () => {
      await sync.addToAccount(5);
      await sync.removeFromAccount(5);
      http.expectNone(() => true);
      expect(sync.status().state).toBe('idle');
    });

    it('add to and remove from the account, and update the last-sync list', async () => {
      keys.set('secret');
      seedLocal(5);
      const first = sync.sync();
      await expectList(1, page([]));
      await expectRequest('POST', 5);
      await first;
      expect(syncedIds()).toEqual([5]);

      const removed = sync.removeFromAccount(5);
      await expectRequest('DELETE', 5);
      await removed;
      expect(syncedIds()).toEqual([]);
      expect(sync.status()).toEqual({ state: 'done', pending: 0, completed: 1, failed: 0 });
    });

    it('replace a change still waiting for the same gallery', async () => {
      setup(100);
      keys.set('secret');
      seedLocal(1);
      const done = sync.sync();
      await expectList(1, page([]));
      await expectRequest('POST', 1);
      // Both wait for the interval; the removal replaces the add.
      void sync.addToAccount(7);
      void sync.removeFromAccount(7);
      await expectRequest('DELETE', 7);
      await done;
      http.expectNone({ method: 'POST', url: `${API}/galleries/7/favorite` });
    });

    it('made while the account is being read are sent after, and win', async () => {
      keys.set('secret');
      seedLocal(1);
      seedSynced([1]);
      const done = sync.sync();
      await settle();
      // The user unfavorites 1 on the device meanwhile; the account still has it.
      void sync.removeFromAccount(1);
      await settle(10);
      await expectList(1, page([1]));
      await expectRequest('DELETE', 1);
      await done;
      http.expectNone({ method: 'POST' });
    });
  });

  describe('init', () => {
    it('starts when a key is set and stops when it is removed', async () => {
      seedLocal(3, 4);
      sync.init();
      TestBed.tick();
      await settle();
      http.expectNone(() => true);

      keys.set('secret');
      TestBed.tick();
      await expectList(1, page([]));
      await expectRequest('POST', 4);

      keys.clear();
      TestBed.tick();
      expect(sync.status().state).toBe('idle');
      await settle(30);
      http.expectNone({ method: 'POST' });
    });

    it('starts over with the new key', async () => {
      seedLocal(3, 4);
      sync.init();
      keys.set('secret');
      TestBed.tick();
      await expectList(1, page([]));
      await expectRequest('POST', 4);

      keys.set('other');
      TestBed.tick();
      await expectList(1, page([3, 4]), 'other');
      await settle(30);
      http.expectNone({ method: 'POST' });
      expect(sync.status().state).toBe('done');
    });

    it('syncs again when the app comes back after a while', async () => {
      const now = vi.spyOn(Date, 'now');
      sync.init();
      keys.set('secret');
      TestBed.tick();
      await expectList(1, page([]));
      await settle();

      setActive(true);
      await settle();
      http.expectNone(`${API}/favorites?page=1`);

      now.mockReturnValue(Date.now() + FAVORITES_RESYNC_AFTER + 1);
      setActive(false);
      setActive(true);
      await expectList(1, page([]));
      now.mockRestore();
    });
  });
});

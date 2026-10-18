import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GalleryDetailResponse } from '../api';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { DOWNLOAD_PAGE_DELAY, DOWNLOAD_SLEEP, DownloadService, PAGE_ATTEMPTS } from './download.service';
import { SavedGalleriesService } from './saved-galleries.service';

const API = 'https://nhentai.net/api/v2';

function gallery(id: number, pageCount = 3): GalleryDetailResponse {
  return {
    id,
    media_id: String(100 + id),
    title: { english: `Gallery ${id}`, japanese: null, pretty: `Pretty ${id}` },
    cover: { path: `galleries/${100 + id}/cover.webp`, width: 350, height: 500 },
    thumbnail: { path: `galleries/${100 + id}/thumb.webp`, width: 250, height: 350 },
    scanlator: '',
    upload_date: 1700000000,
    tags: [],
    num_pages: pageCount,
    num_favorites: 0,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      number: i + 1,
      path: `galleries/${100 + id}/${i + 1}.webp`,
      width: 1000,
      height: 1400,
      thumbnail: `galleries/${100 + id}/${i + 1}t.webp`,
      thumbnail_width: 200,
      thumbnail_height: 280,
    })),
  };
}

const pageUrl = (id: number, page: number) => `https://i.example/galleries/${100 + id}/${page}.webp`;
const image = () => new Blob(['img'], { type: 'image/webp' });

describe('DownloadService', () => {
  let db: FakeDatabase;
  let http: HttpTestingController;
  let service: DownloadService;
  let events: string[];
  let sleep: ReturnType<typeof vi.fn>;

  function setUp() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        { provide: DOWNLOAD_PAGE_DELAY, useValue: 2000 },
        { provide: DOWNLOAD_SLEEP, useValue: sleep },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DownloadService);
  }

  beforeEach(() => {
    db = new FakeDatabase();
    events = [];
    sleep = vi.fn(async (ms: number) => {
      events.push(`wait ${ms}`);
    });
  });

  afterEach(() => http.verify());

  /** Answers every pending request to `url` once one shows up. */
  async function respond(url: string, body: Blob | object, label?: string) {
    await vi.waitFor(() => {
      const requests = http.match(url);
      if (requests.length === 0) {
        throw new Error(`no request to ${url} yet`);
      }
      requests.forEach((request) => request.flush(body));
    });
    if (label) {
      events.push(label);
    }
  }
  async function cdn() {
    await respond(`${API}/cdn`, { thumb_servers: ['https://t.example'], image_servers: ['https://i.example'] });
  }

  it('saves the details and cover, then every page in order, waiting 2 seconds between pages', async () => {
    setUp();
    const started = service.download(gallery(1));
    await cdn();
    await respond('https://t.example/galleries/101/cover.webp', image());
    await started;

    expect(db.saved.get(1)).toMatchObject({ title_english: 'Gallery 1', is_favorite: 0, download_status: 'queued' });
    expect(db.saved.get(1)!['cover_base64']).toContain('data:image/webp;base64,');
    expect(service.jobs()).toEqual([
      expect.objectContaining({ id: 1, title: 'Gallery 1', totalPages: 3 }),
    ]);

    for (const page of [1, 2, 3]) {
      await respond(pageUrl(1, page), image(), `page ${page}`);
      await vi.waitFor(() => expect(service.jobs()[0]?.downloadedPages ?? 3).toBeGreaterThanOrEqual(page));
    }
    await vi.waitFor(() => expect(service.jobs()).toEqual([]));

    expect(events).toEqual(['page 1', 'wait 2000', 'page 2', 'wait 2000', 'page 3']);
    expect([...db.pages.keys()].sort()).toEqual(['1:1', '1:2', '1:3']);
    expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, download_status: null, is_favorite: 0 });
    expect(service.downloaded().map((g) => g.id)).toEqual([1]);
    expect(service.stateOf(1)).toBe('downloaded');
  });

  it('reports live progress for each page', async () => {
    setUp();
    const started = service.download(gallery(1, 2));
    await cdn();
    await respond('https://t.example/galleries/101/cover.webp', image());
    await started;

    await vi.waitFor(() => expect(service.stateOf(1)).toBe('downloading'));
    expect(service.jobs()[0].downloadedPages).toBe(0);
    await respond(pageUrl(1, 1), image());
    await vi.waitFor(() => expect(service.jobs()[0].downloadedPages).toBe(1));
    await respond(pageUrl(1, 2), image());
    await vi.waitFor(() => expect(service.jobs()).toEqual([]));
  });

  it('downloads one gallery at a time, in the order they were added', async () => {
    setUp();
    const first = service.download(gallery(1, 1));
    await cdn();
    await respond('https://t.example/galleries/101/cover.webp', image());
    await first;
    const second = service.download(gallery(2, 1));
    await respond('https://t.example/galleries/102/cover.webp', image());
    await second;

    expect(service.jobs().map((job) => [job.id, job.status])).toEqual([
      [1, 'downloading'],
      [2, 'queued'],
    ]);
    http.expectNone(pageUrl(2, 1));
    await respond(pageUrl(1, 1), image());
    await respond(pageUrl(2, 1), image());
    await vi.waitFor(() => expect(service.downloaded().map((g) => g.id).sort()).toEqual([1, 2]));
  });

  it('is independent from favorites', async () => {
    db.seedSaved({ id: 1, is_favorite: 1, favorited_at: 5, details_json: JSON.stringify(gallery(1, 1)) });
    setUp();
    const started = service.download(gallery(1, 1));
    await cdn();
    await respond('https://t.example/galleries/101/cover.webp', image());
    await started;

    // Unfavoriting while it downloads keeps the download.
    await TestBed.inject(SavedGalleriesService).removeFavorite(1);
    expect(db.saved.get(1)).toMatchObject({ is_favorite: 0, download_status: 'queued' });

    await respond(pageUrl(1, 1), image());
    await vi.waitFor(() => expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, is_favorite: 0 }));
  });

  it('resumes unfinished downloads on launch, skipping pages already saved', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 3)) });
    db.seedPage(1, 1);
    setUp();

    await service.init();
    expect(service.jobs()).toEqual([expect.objectContaining({ id: 1, downloadedPages: 1, totalPages: 3 })]);

    await cdn();
    await respond(pageUrl(1, 2), image());
    await respond(pageUrl(1, 3), image());
    await vi.waitFor(() => expect(db.saved.get(1)!['is_downloaded']).toBe(1));
    http.expectNone(pageUrl(1, 1));
  });

  it('retries a failing page, then marks the download failed, and can resume it', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 2)) });
    setUp();
    await service.init();
    await cdn();

    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      await vi.waitFor(() => {
        const requests = http.match(pageUrl(1, 1));
        if (!requests.length) throw new Error('waiting');
        requests.forEach((r) => r.error(new ProgressEvent('error'), { status: 429, statusText: 'Too Many Requests' }));
      });
    }
    await vi.waitFor(() => expect(service.stateOf(1)).toBe('failed'));
    expect(db.saved.get(1)!['download_status']).toBe('failed');
    // Longer waits after each failed attempt.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);

    await service.retry(1);
    await respond(pageUrl(1, 1), image());
    await respond(pageUrl(1, 2), image());
    await vi.waitFor(() => expect(service.stateOf(1)).toBe('downloaded'));
  });

  it('removes a download with its pages, keeping the gallery only if it is a favorite', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1, downloaded_at: 1 });
    db.seedSaved({ id: 2, is_favorite: 1, is_downloaded: 1, downloaded_at: 2 });
    db.seedPage(1, 1);
    db.seedPage(2, 1);
    setUp();
    await service.loadDownloaded();

    await service.remove(1);
    await service.remove(2);

    expect(db.saved.has(1)).toBe(false);
    expect(db.saved.get(2)).toMatchObject({ is_favorite: 1, is_downloaded: 0 });
    expect(db.pages.size).toBe(0);
    expect(service.downloaded()).toEqual([]);
  });

  it('stops a running download when it is cancelled', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 3)) });
    setUp();
    await service.init();
    await cdn();
    await respond(pageUrl(1, 1), image());
    await vi.waitFor(() => expect(service.jobs()[0].downloadedPages).toBe(1));

    await service.remove(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    http.match(pageUrl(1, 2)).forEach((r) => r.flush(image()));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(db.saved.has(1)).toBe(false);
    expect(db.pages.size).toBe(0);
    expect(service.jobs()).toEqual([]);
  });

  it('returns the saved pages for the reader', async () => {
    db.seedPage(1, 2, 'data:b');
    db.seedPage(1, 1, 'data:a');
    setUp();
    expect([...(await service.getPages(1))]).toEqual([
      [1, 'data:a'],
      [2, 'data:b'],
    ]);
    expect((await service.getPages(9)).size).toBe(0);
  });

  it('clears downloads after a backup import, keeping favorites', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1 });
    db.seedSaved({ id: 2, is_favorite: 1, is_downloaded: 1 });
    db.seedSaved({ id: 3, is_favorite: 0, download_status: 'queued' });
    db.seedPage(1, 1);
    setUp();

    await service.resetAfterImport();

    expect([...db.saved.keys()]).toEqual([2]);
    expect(db.saved.get(2)).toMatchObject({ is_downloaded: 0, download_status: null });
    expect(db.pages.size).toBe(0);
  });
});

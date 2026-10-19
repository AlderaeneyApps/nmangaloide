import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { GalleryDetailResponse } from '../api';
import {
  NATIVE_DOWNLOADER,
  NativeDownloadJob,
  NativeDownloadLabels,
  NativeDownloadState,
  NativeDownloader,
} from '../native/background-downloads';
import { ZipWriter, base64ToBytes, bytesToBase64, concat, readZip } from '../native/cbz';
import { textToBase64 } from '../native/download-folder';
import { APP_ACTIVE_LISTENER } from '../native/download-keep-alive';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import {
  FakeAppFiles,
  FakeDownloadStorage,
  FakePreferences,
  TEST_FOLDER,
  provideFakeDownloads,
} from '../testing/fake-download-storage';
import {
  DOWNLOAD_PAGE_DELAY,
  DOWNLOAD_SLEEP,
  DownloadService,
  PAGE_ATTEMPTS,
  pageFileName,
  pageNumberOf,
} from './download.service';
import { SavedGalleriesService } from './saved-galleries.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const API = 'https://nhentai.net/api/v2';
const ROOT = TEST_FOLDER.uri;

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
const coverUrl = (id: number) => `https://t.example/galleries/${100 + id}/cover.webp`;
const image = (content = 'img') => new Blob([content], { type: 'image/webp' });

/** A CBZ as another phone would have written it. */
function cbzOf(details: GalleryDetailResponse | null, pages: number[]): string {
  const zip = new ZipWriter();
  const parts: Uint8Array[] = [];
  if (details) {
    parts.push(zip.add('gallery.json', new TextEncoder().encode(JSON.stringify(details))));
  }
  for (const page of pages) {
    parts.push(zip.add(pageFileName(page, pages.length, '.webp'), new TextEncoder().encode(`page ${page}`)));
  }
  parts.push(zip.finish());
  return bytesToBase64(concat(parts));
}

describe('DownloadService', () => {
  let db: FakeDatabase;
  let storage: FakeDownloadStorage;
  let preferences: FakePreferences;
  let appFiles: FakeAppFiles;
  let http: HttpTestingController;
  let service: DownloadService;
  let events: string[];
  let sleep: ReturnType<typeof vi.fn>;

  function setUp({ folderChosen = true, providers = [] as Provider[] } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        provideFakeDownloads(storage, preferences, folderChosen, appFiles),
        { provide: DOWNLOAD_PAGE_DELAY, useValue: 2000 },
        { provide: DOWNLOAD_SLEEP, useValue: sleep },
        ...providers,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DownloadService);
  }

  beforeEach(() => {
    db = new FakeDatabase();
    storage = new FakeDownloadStorage();
    preferences = new FakePreferences();
    appFiles = new FakeAppFiles();
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
  /** The entries of a CBZ in the folder, with their contents as text. */
  async function cbzContents(id: number, root: string | null = ROOT) {
    const file = storage.files.get(`${root ?? 'app'}/${id}.cbz`);
    expect(file).toBeDefined();
    const entries = readZip(base64ToBytes(file!.data));
    return Promise.all(entries.map(async (entry) => [entry.name, new TextDecoder().decode(await entry.bytes())]));
  }
  async function downloadAll(id: number, pages: number) {
    for (let page = 1; page <= pages; page++) {
      await respond(pageUrl(id, page), image(`page ${page}`));
    }
    await vi.waitFor(() => expect(service.stateOf(id)).toBe('downloaded'));
  }

  it('names page files by number, padded to 3 digits', () => {
    setUp();
    expect(pageFileName(7, 30, 'galleries/1/7.webp')).toBe('007.webp');
    expect(pageFileName(12, 1200, 'galleries/1/12.jpg')).toBe('0012.jpg');
    expect(pageNumberOf('007.webp')).toBe(7);
    expect(pageNumberOf('0012.JPG')).toBe(12);
    expect(pageNumberOf('gallery.json')).toBeNull();
  });

  it('keeps pages private while downloading, then saves the comic as one CBZ file', async () => {
    setUp();
    const started = service.download(gallery(1));
    await cdn();
    await respond(coverUrl(1), image());
    await started;

    expect(db.saved.get(1)).toMatchObject({ title_english: 'Gallery 1', is_favorite: 0, download_status: 'queued' });
    expect(db.saved.get(1)!['cover_base64']).toContain('data:image/webp;base64,');
    expect(service.jobs()).toEqual([expect.objectContaining({ id: 1, title: 'Gallery 1', totalPages: 3 })]);

    await respond(pageUrl(1, 1), image('page 1'), 'page 1');
    await vi.waitFor(() => expect(appFiles.keys('staging')).toEqual(['1/001.webp']));
    // Nothing in the download folder (so nothing in the phone's gallery) until the comic is complete.
    expect(storage.files.size).toBe(0);
    await respond(pageUrl(1, 2), image('page 2'), 'page 2');
    await respond(pageUrl(1, 3), image('page 3'), 'page 3');
    await vi.waitFor(() => expect(service.jobs()).toEqual([]));

    expect(events).toEqual(['page 1', 'wait 2000', 'page 2', 'wait 2000', 'page 3']);
    expect([...storage.files.keys()]).toEqual([`${ROOT}/1.cbz`]);
    const contents = await cbzContents(1);
    expect(contents.map(([name]) => name)).toEqual(['gallery.json', 'ComicInfo.xml', '001.webp', '002.webp', '003.webp']);
    expect(contents[2][1]).toBe('page 1');
    expect(JSON.parse(contents[0][1])).toMatchObject({ id: 1, title: { english: 'Gallery 1' } });
    expect(contents[1][1]).toContain('<Title>Gallery 1</Title>');
    expect(appFiles.files.size).toBe(0);
    expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, download_status: null, is_favorite: 0 });
    expect(service.downloaded().map((g) => g.id)).toEqual([1]);
  });

  it('reports live progress for each page', async () => {
    setUp();
    const started = service.download(gallery(1, 2));
    await cdn();
    await respond(coverUrl(1), image());
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
    await respond(coverUrl(1), image());
    await first;
    const second = service.download(gallery(2, 1));
    await respond(coverUrl(2), image());
    await second;

    expect(service.jobs().map((job) => [job.id, job.status])).toEqual([
      [1, 'downloading'],
      [2, 'queued'],
    ]);
    http.expectNone(pageUrl(2, 1));
    await respond(pageUrl(1, 1), image());
    await respond(pageUrl(2, 1), image());
    await vi.waitFor(() => expect(service.downloaded().map((g) => g.id).sort()).toEqual([1, 2]));
    expect([...storage.files.keys()].sort()).toEqual([`${ROOT}/1.cbz`, `${ROOT}/2.cbz`]);
  });

  it('is independent from favorites', async () => {
    db.seedSaved({ id: 1, is_favorite: 1, favorited_at: 5, details_json: JSON.stringify(gallery(1, 1)) });
    setUp();
    const started = service.download(gallery(1, 1));
    await cdn();
    await respond(coverUrl(1), image());
    await started;

    // Unfavoriting while it downloads keeps the download.
    await TestBed.inject(SavedGalleriesService).removeFavorite(1);
    expect(db.saved.get(1)).toMatchObject({ is_favorite: 0, download_status: 'queued' });

    await respond(pageUrl(1, 1), image());
    await vi.waitFor(() => expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, is_favorite: 0 }));
  });

  it('resumes unfinished downloads on launch, skipping pages already saved', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 3)) });
    await appFiles.write('staging', '1', '001.webp', btoa('page 1'));
    setUp();

    await service.init();
    expect(service.jobs()).toEqual([expect.objectContaining({ id: 1, downloadedPages: 1, totalPages: 3 })]);

    await cdn();
    await respond(pageUrl(1, 2), image('page 2'));
    await respond(pageUrl(1, 3), image('page 3'));
    await vi.waitFor(() => expect(db.saved.get(1)!['is_downloaded']).toBe(1));
    http.expectNone(pageUrl(1, 1));
    expect((await cbzContents(1)).slice(2)).toEqual([
      ['001.webp', 'page 1'],
      ['002.webp', 'page 2'],
      ['003.webp', 'page 3'],
    ]);
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
    await downloadAll(1, 2);
  });

  it('deletes the CBZ when a download is removed, keeping the gallery only if it is a favorite', async () => {
    db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1, downloaded_at: 1 });
    db.seedSaved({ id: 2, is_favorite: 1, is_downloaded: 1, downloaded_at: 2 });
    storage.seed(ROOT, '1.cbz', cbzOf(gallery(1, 1), [1]));
    storage.seed(ROOT, '2.cbz', cbzOf(gallery(2, 1), [1]));
    setUp();
    await service.init();

    await service.remove(1);
    await service.remove(2);

    expect(db.saved.has(1)).toBe(false);
    expect(db.saved.get(2)).toMatchObject({ is_favorite: 1, is_downloaded: 0 });
    expect(storage.files.size).toBe(0);
    expect(service.downloaded()).toEqual([]);
  });

  it('stops a running download when it is cancelled, leaving no files behind', async () => {
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
    expect(storage.files.size).toBe(0);
    expect(appFiles.files.size).toBe(0);
    expect(service.jobs()).toEqual([]);
  });

  describe('reading a download', () => {
    it('unpacks the CBZ into a temporary folder and removes it when done', async () => {
      storage.seed(ROOT, '1.cbz', cbzOf(gallery(1, 2), [2, 1]));
      setUp();

      expect([...(await service.getPages(1))]).toEqual([
        [2, 'app-src:reader/1/002.webp'],
        [1, 'app-src:reader/1/001.webp'],
      ]);
      expect(atob(await appFiles.read('reader', '1', '001.webp'))).toBe('page 1');
      expect(appFiles.keys('reader')).toEqual(['1/001.webp', '1/002.webp']);

      await service.releasePages(1);
      expect(appFiles.keys('reader')).toEqual([]);
    });

    it('removes pages unpacked for another comic first', async () => {
      storage.seed(ROOT, '1.cbz', cbzOf(gallery(1, 1), [1]));
      storage.seed(ROOT, '2.cbz', cbzOf(gallery(2, 1), [1]));
      setUp();
      await service.getPages(1);
      await service.getPages(2);
      expect(appFiles.keys('reader')).toEqual(['2/001.webp']);
    });

    it('has no pages for a gallery that is not downloaded', async () => {
      setUp();
      expect((await service.getPages(9)).size).toBe(0);
      expect(appFiles.files.size).toBe(0);
    });

    it('cleans up pages left unpacked when the app was closed while reading', async () => {
      await appFiles.write('reader', '1', '001.webp', 'AAAA');
      setUp();
      await service.init();
      expect(appFiles.keys('reader')).toEqual([]);
    });
  });

  describe('on Android, without a download folder', () => {
    beforeEach(() => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 1)) });
    });

    it('keeps downloads waiting until a folder is chosen', async () => {
      setUp({ folderChosen: false });
      await service.init();
      expect(service.folderReady()).toBe(false);
      expect(service.jobs()).toEqual([expect.objectContaining({ id: 1, status: 'queued' })]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      http.expectNone(`${API}/cdn`);

      await service.chooseFolder();
      expect(JSON.parse(preferences.values.get('download_folder')!)).toEqual(TEST_FOLDER);
      await cdn();
      await downloadAll(1, 1);
      expect([...storage.files.keys()]).toEqual([`${ROOT}/1.cbz`]);
    });

    it('forgets a folder the app lost access to', async () => {
      storage.accessible.clear();
      setUp();
      await service.init();
      expect(service.folderReady()).toBe(false);
    });
  });

  it('needs no folder choice on iOS (the app folder in Files)', async () => {
    storage = new FakeDownloadStorage('files-app');
    db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 1)) });
    setUp({ folderChosen: false });
    await service.init();
    expect(service.folderReady()).toBe(true);
    await cdn();
    await downloadAll(1, 1);
    expect([...storage.files.keys()]).toEqual(['app/1.cbz']);
  });

  describe('scanning the download folder', () => {
    it('lists CBZ files copied from another phone, reading their details from gallery.json', async () => {
      storage.seed(ROOT, '5.cbz', cbzOf(gallery(5, 2), [1, 2]));
      storage.seed(ROOT, 'notes.txt'); // not a download
      setUp();
      const ready = service.init();
      await cdn();
      await respond(coverUrl(5), image());
      await ready;

      expect(service.downloaded().map((g) => g.id)).toEqual([5]);
      expect(db.saved.get(5)).toMatchObject({ title_english: 'Gallery 5', is_downloaded: 1, is_favorite: 0 });
      expect(db.saved.get(5)!['cover_base64']).toContain('data:image/webp;base64,');
      expect(JSON.parse(db.saved.get(5)!['details_json'] as string).pages).toHaveLength(2);
    });

    it('uses the first page as the cover when the cover cannot be fetched', async () => {
      storage.seed(ROOT, '5.cbz', cbzOf(gallery(5, 2), [1, 2]));
      setUp();
      const ready = service.init();
      await vi.waitFor(() => {
        const requests = http.match(`${API}/cdn`);
        if (!requests.length) throw new Error('waiting');
        requests.forEach((r) => r.error(new ProgressEvent('offline')));
      });
      await ready;

      expect(db.saved.get(5)!['cover_base64']).toBe(`data:image/webp;base64,${btoa('page 1')}`);
    });

    it('ignores CBZ files without details, and unfinished ones', async () => {
      storage.seed(ROOT, '7.cbz', cbzOf(null, [1]));
      storage.seed(ROOT, '8.cbz.part', cbzOf(gallery(8, 1), [1]));
      setUp();
      await service.init();
      expect(service.downloaded()).toEqual([]);
      expect(db.saved.size).toBe(0);
    });

    it('forgets downloads whose CBZ is gone, keeping favorites', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1, downloaded_at: 1 });
      db.seedSaved({ id: 2, is_favorite: 1, is_downloaded: 1, downloaded_at: 2 });
      db.seedSaved({ id: 3, is_favorite: 0, is_downloaded: 1, downloaded_at: 3 });
      storage.seed(ROOT, '3.cbz', cbzOf(gallery(3, 1), [1]));
      setUp();
      await service.init();

      expect(db.saved.has(1)).toBe(false);
      expect(db.saved.get(2)).toMatchObject({ is_favorite: 1, is_downloaded: 0 });
      expect(service.downloaded().map((g) => g.id)).toEqual([3]);
    });

    it('converts gallery folders from the earlier format into CBZ files', async () => {
      db.seedSaved({ id: 4, is_favorite: 0, is_downloaded: 1, downloaded_at: 1, details_json: JSON.stringify(gallery(4, 2)) });
      storage.seed(ROOT, '4/gallery.json', textToBase64(JSON.stringify(gallery(4, 2))), 'application/json');
      storage.seed(ROOT, '4/001.webp', btoa('page 1'));
      storage.seed(ROOT, '4/002.webp', btoa('page 2'));
      // Not saved on this phone: the details come from the folder.
      storage.seed(ROOT, '6/gallery.json', textToBase64(JSON.stringify(gallery(6, 1))), 'application/json');
      storage.seed(ROOT, '6/001.webp', btoa('page 1'));
      setUp();
      const ready = service.init();
      await cdn();
      await respond(coverUrl(6), image());
      await ready;

      await vi.waitFor(() => expect(service.downloaded().map((g) => g.id).sort()).toEqual([4, 6]));
      // Nothing had to be downloaded again.
      http.expectNone(pageUrl(4, 1));
      expect([...storage.files.keys()].sort()).toEqual([`${ROOT}/4.cbz`, `${ROOT}/6.cbz`]);
      expect((await cbzContents(4)).slice(2)).toEqual([
        ['001.webp', 'page 1'],
        ['002.webp', 'page 2'],
      ]);
    });

    it('switches to another folder: what is there shows up, the rest is no longer listed', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1, downloaded_at: 1, cover_base64: 'data:a' });
      storage.seed(ROOT, '1.cbz', cbzOf(gallery(1, 1), [1]));
      storage.seed('content://other', '8.cbz', cbzOf(gallery(8, 1), [1]));
      setUp();
      await service.init();
      expect(service.downloaded().map((g) => g.id)).toEqual([1]);

      storage.pickResult = { uri: 'content://other', name: 'Other' };
      const chosen = service.chooseFolder();
      await cdn();
      await respond(coverUrl(8), image());
      await chosen;

      expect(service.downloaded().map((g) => g.id)).toEqual([8]);
      expect(db.saved.has(1)).toBe(false);
      // The old folder's file stays where it is.
      expect(storage.files.has(`${ROOT}/1.cbz`)).toBe(true);
    });

    it('rebuilds the downloads from the folder after a backup import', async () => {
      // The imported database lists another phone's downloads.
      db.seedSaved({ id: 1, is_favorite: 0, is_downloaded: 1 });
      db.seedSaved({ id: 2, is_favorite: 1, is_downloaded: 1, cover_base64: 'data:b', details_json: JSON.stringify(gallery(2, 1)) });
      db.seedSaved({ id: 3, is_favorite: 0, download_status: 'queued' });
      await appFiles.write('staging', '3', '001.webp', 'AAAA');
      storage.seed(ROOT, '2.cbz', cbzOf(gallery(2, 1), [1]));
      setUp();

      // Saved details are reused: no API calls.
      await service.resetAfterImport();

      expect([...db.saved.keys()]).toEqual([2]);
      expect(db.saved.get(2)).toMatchObject({ is_favorite: 1, is_downloaded: 1, download_status: null });
      expect(service.downloaded().map((g) => g.id)).toEqual([2]);
      expect(service.jobs()).toEqual([]);
      expect(appFiles.files.size).toBe(0);
    });

    it('removes private pages of downloads that are no longer queued', async () => {
      await appFiles.write('staging', '9', '001.webp', 'AAAA');
      setUp();
      await service.init();
      expect(appFiles.files.size).toBe(0);
    });
  });
  describe('on Android, with the native downloader', () => {
    let native: FakeNativeDownloader;
    let setActive: (active: boolean) => void;

    function setUpNative() {
      native = new FakeNativeDownloader();
      setUp({
        providers: [
          { provide: NATIVE_DOWNLOADER, useValue: native },
          { provide: APP_ACTIVE_LISTENER, useValue: (listener: (active: boolean) => void) => (setActive = listener) },
        ],
      });
    }

    /** What the native side does when a comic is complete: the CBZ is in the folder, the staged pages gone. */
    async function finishNatively(id: number, pages: number) {
      storage.seed(ROOT, `${id}.cbz`, cbzOf(gallery(id, pages), Array.from({ length: pages }, (_, i) => i + 1)));
      await appFiles.remove('staging', String(id));
      native.emit({ id, done: pages, total: pages, status: 'finished' });
    }

    it('hands a new download over, with everything needed to write the CBZ, instead of downloading it here', async () => {
      setUpNative();
      const started = service.download(gallery(1, 2));
      await cdn();
      await respond(coverUrl(1), image());
      await started;

      await vi.waitFor(() => expect(native.jobs).toHaveLength(1));
      const job = native.jobs[0];
      expect(job).toMatchObject({
        id: 1,
        title: 'Gallery 1',
        folderUri: ROOT,
        delayMs: 2000,
        pages: [
          { number: 1, url: pageUrl(1, 1), fileName: '001.webp' },
          { number: 2, url: pageUrl(1, 2), fileName: '002.webp' },
        ],
      });
      expect(JSON.parse(job.detailsJson)).toMatchObject({ id: 1, title: { english: 'Gallery 1' } });
      expect(job.comicInfoXml).toContain('<Title>Gallery 1</Title>');
      // The app itself downloads no pages.
      http.expectNone(pageUrl(1, 1));
      expect(db.saved.get(1)).toMatchObject({ download_status: 'queued' });
    });

    it('follows the native progress, and lists the comic as downloaded once its CBZ is written', async () => {
      setUpNative();
      const started = service.download(gallery(1, 2));
      await cdn();
      await respond(coverUrl(1), image());
      await started;
      await vi.waitFor(() => expect(native.jobs).toHaveLength(1));

      native.emit({ id: 1, done: 1, total: 2, status: 'downloading' });
      await vi.waitFor(() => expect(service.jobs()).toEqual([expect.objectContaining({ id: 1, status: 'downloading', downloadedPages: 1 })]));

      await finishNatively(1, 2);
      await vi.waitFor(() => expect(service.stateOf(1)).toBe('downloaded'));
      expect(service.jobs()).toEqual([]);
      expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, download_status: null });
    });

    it('marks a download failed when the native side gives up, and hands it over again on retry', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 2)) });
      setUpNative();
      await service.init();
      await cdn();
      await vi.waitFor(() => expect(native.jobs).toHaveLength(1));

      native.emit({ id: 1, done: 0, total: 2, status: 'failed' });
      await vi.waitFor(() => expect(service.stateOf(1)).toBe('failed'));
      expect(db.saved.get(1)!['download_status']).toBe('failed');

      await service.retry(1);
      await vi.waitFor(() => expect(native.jobs).toHaveLength(2));
      expect(service.stateOf(1)).toBe('queued');
    });

    it('resumes on launch: hands over waiting downloads and keeps failed ones aside', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', updated_at: 1, details_json: JSON.stringify(gallery(1, 3)) });
      db.seedSaved({ id: 2, is_favorite: 0, download_status: 'failed', updated_at: 2, details_json: JSON.stringify(gallery(2, 1)) });
      await appFiles.write('staging', '1', '001.webp', btoa('page 1'));
      setUpNative();
      await service.init();
      await cdn();

      await vi.waitFor(() => expect(native.jobs.map((job) => job.id)).toEqual([1]));
      // Pages already saved stay where the native side looks for them.
      expect(appFiles.keys('staging')).toEqual(['1/001.webp']);
    });

    it('lists a comic that finished while the app was closed as downloaded', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 1)) });
      storage.seed(ROOT, '1.cbz', cbzOf(gallery(1, 1), [1]));
      setUpNative();
      await service.init();

      expect(service.stateOf(1)).toBe('downloaded');
      expect(db.saved.get(1)).toMatchObject({ is_downloaded: 1, download_status: null });
      expect(native.jobs).toEqual([]);
    });

    it('stops the native download when it is removed', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 2)) });
      setUpNative();
      await service.init();
      await cdn();
      await vi.waitFor(() => expect(native.jobs).toHaveLength(1));

      await service.remove(1);
      expect(native.cancelled).toEqual([1]);
      expect(service.jobs()).toEqual([]);
      expect(db.saved.has(1)).toBe(false);
      // Late progress from the native side is ignored.
      await finishNatively(1, 2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.stateOf(1)).toBeNull();
    });

    it('hands the queue over again when the app is opened if Android refused to start the service', async () => {
      db.seedSaved({ id: 1, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify(gallery(1, 2)) });
      setUpNative();
      native.enqueueError = Object.assign(new Error('not allowed'), { code: 'NOT_ALLOWED' });
      await service.init();
      await cdn();
      await vi.waitFor(() => expect(native.jobs).toHaveLength(1));
      // Not a failure: it waits.
      expect(service.stateOf(1)).toBe('queued');

      setActive(true);
      await vi.waitFor(() => expect(native.jobs).toHaveLength(2));
      expect(service.stateOf(1)).toBe('queued');
    });
  });
});

/** The native downloader (Android), recording what it's handed. */
class FakeNativeDownloader implements NativeDownloader {
  readonly jobs: NativeDownloadJob[] = [];
  readonly cancelled: number[] = [];
  labels: NativeDownloadLabels | null = null;
  /** Thrown (once) by the next enqueue(), after recording the job. */
  enqueueError: unknown = null;
  private listener: ((state: NativeDownloadState) => void) | null = null;

  async enqueue(job: NativeDownloadJob): Promise<NativeDownloadState> {
    this.jobs.push(job);
    if (this.enqueueError) {
      const error = this.enqueueError;
      this.enqueueError = null;
      throw error;
    }
    return { id: job.id, done: 0, total: job.pages.length, status: 'queued' };
  }

  async cancel(id: number): Promise<void> {
    this.cancelled.push(id);
  }

  async setLabels(labels: NativeDownloadLabels): Promise<void> {
    this.labels = labels;
  }

  onProgress(listener: (state: NativeDownloadState) => void): void {
    this.listener = listener;
  }

  emit(state: NativeDownloadState): void {
    this.listener?.(state);
  }
}

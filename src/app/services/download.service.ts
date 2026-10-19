import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CdnService, GalleryDetailResponse } from '../api';
import { ZipWriter, base64ToBytes, bytesToBase64, comicInfoXml, readZip } from '../native/cbz';
import {
  APP_FILES,
  DOWNLOAD_STORAGE,
  FolderEntry,
  PickedFolder,
  base64ToText,
  mimeTypeOf,
  stripDataUrl,
} from '../native/download-folder';
import { DatabaseService } from '../sql-services/database.service';
import { DownloadFolderService } from './download-folder.service';
import { SUMMARY_COLUMNS, SavedGalleriesService, SavedGallery, blobToDataUrl } from './saved-galleries.service';

/** Wait between page downloads, so the image servers' rate limit isn't hit. */
export const DOWNLOAD_PAGE_DELAY = new InjectionToken<number>('DOWNLOAD_PAGE_DELAY', {
  providedIn: 'root',
  factory: () => 2000,
});

/** Waits `ms` milliseconds; a token so tests can record the pauses without waiting. */
export const DOWNLOAD_SLEEP = new InjectionToken<(ms: number) => Promise<void>>('DOWNLOAD_SLEEP', {
  providedIn: 'root',
  factory: () => (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()),
});

/** Attempts per page before the gallery's download is marked as failed. */
export const PAGE_ATTEMPTS = 3;

/** The gallery's details, saved in its CBZ so the file works on another phone. */
export const DETAILS_FILE = 'gallery.json';
/** Metadata most comic reader apps understand. */
export const COMIC_INFO_FILE = 'ComicInfo.xml';

/** A downloaded gallery's file in the download folder: `<id>.cbz`. */
export function cbzName(id: number): string {
  return `${id}.cbz`;
}
/** The file while it's being written; renamed to `<id>.cbz` once complete. */
function partName(id: number): string {
  return `${id}.cbz.part`;
}
const CBZ_FILE = /^(\d+)\.cbz$/i;

/** Page images are named by page number: `001.webp`, `002.jpg`… */
const PAGE_FILE = /^(\d+)\.(webp|jpe?g|png|gif|avif)$/i;

/** The file name for a page: its number, zero-padded (at least 3 digits), and its image type. */
export function pageFileName(number: number, totalPages: number, path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? 'jpg';
  return `${String(number).padStart(Math.max(3, String(totalPages).length), '0')}.${extension}`;
}

/** The page number of a page file, or null for any other file. */
export function pageNumberOf(fileName: string): number | null {
  const match = PAGE_FILE.exec(fileName);
  return match ? Number(match[1]) : null;
}

export type DownloadStatus = 'queued' | 'downloading' | 'failed';

/** A gallery being downloaded (or waiting, or stopped by errors). */
export interface DownloadJob {
  id: number;
  title: string;
  totalPages: number;
  downloadedPages: number;
  status: DownloadStatus;
}

interface QueueRow {
  id: number;
  title_english: string;
  title_pretty: string;
  num_pages: number;
  download_status: 'queued' | 'failed';
  details_json: string;
}

/**
 * Downloads galleries in the background while the app is open: one gallery at a
 * time, one page at a time, waiting DOWNLOAD_PAGE_DELAY between pages.
 *
 * Pages are first saved in the app's private storage (APP_FILES `staging`, never seen
 * by the gallery or Files apps), so an interrupted download resumes where it stopped.
 * When all pages are there they're packed into `<id>.cbz` in the download folder
 * (see DownloadFolderService): a ZIP with the pages (`001.webp`…), the gallery's
 * details (`gallery.json`) and `ComicInfo.xml`. Reading a download unpacks it into a
 * temporary folder (APP_FILES `reader`), removed when the reader closes.
 *
 * The CBZ files can be copied to another phone: on start (and when a folder is chosen
 * or a backup imported) the folder is scanned, so CBZ files found there show as
 * downloaded and downloads whose file is gone are forgotten.
 *
 * The database keeps the details and cover (`saved_galleries`, shared with favorites)
 * and the download state. Downloads are independent from favorites.
 */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly db = inject(DatabaseService);
  private readonly http = inject(HttpClient);
  private readonly cdn = inject(CdnService);
  private readonly saved = inject(SavedGalleriesService);
  private readonly folders = inject(DownloadFolderService);
  private readonly storage = inject(DOWNLOAD_STORAGE);
  private readonly files = inject(APP_FILES);
  private readonly pageDelay = inject(DOWNLOAD_PAGE_DELAY);
  private readonly sleep = inject(DOWNLOAD_SLEEP);

  private readonly _jobs = signal<DownloadJob[]>([]);
  private readonly _downloaded = signal<SavedGallery[]>([]);
  private readonly details = new Map<number, GalleryDetailResponse>();
  private readonly cancelled = new Set<number>();
  private worker: Promise<void> | null = null;
  private initializing: Promise<void> | null = null;
  private loadingDownloaded: Promise<void> | null = null;

  /** Galleries downloading or waiting, in order, with live page counts. */
  readonly jobs = this._jobs.asReadonly();
  /** Finished downloads, most recent first. */
  readonly downloaded = this._downloaded.asReadonly();
  readonly downloadedIds = computed(() => new Set(this._downloaded().map((gallery) => gallery.id)));
  readonly activeIds = computed(() => new Set(this._jobs().map((job) => job.id)));
  /** Whether downloads can be saved (on Android a folder must be chosen first). */
  readonly folderReady = this.folders.ready;

  /** Loads the download folder and unfinished downloads, scans the folder, and resumes. Safe to call repeatedly. */
  init(): Promise<void> {
    this.initializing ??= (async () => {
      // Pages left unpacked if the app was closed while reading.
      await this.files.remove('reader').catch(() => undefined);
      await this.folders.load();
      await this.restoreQueue();
      await this.sync().catch(() => undefined);
      await this.removeOrphanedPages();
    })().then(
      () => this.kick(),
      (error) => {
        this.initializing = null;
        throw error;
      },
    );
    return this.initializing;
  }

  /** Reads the finished downloads (once; later calls reuse the result). */
  loadDownloaded(): Promise<void> {
    this.loadingDownloaded ??= this.db
      .query<SavedGallery>(
        `SELECT ${SUMMARY_COLUMNS} FROM saved_galleries WHERE is_downloaded = 1 ORDER BY downloaded_at DESC`,
      )
      .then(
        (rows) => this._downloaded.set(rows),
        (error) => {
          this.loadingDownloaded = null;
          throw error;
        },
      );
    return this.loadingDownloaded;
  }

  /** 'downloaded', 'downloading' (or waiting / failed) or null for a gallery. */
  stateOf(id: number): 'downloaded' | DownloadStatus | null {
    if (this.downloadedIds().has(id)) {
      return 'downloaded';
    }
    return this._jobs().find((job) => job.id === id)?.status ?? null;
  }

  /**
   * Shows the folder picker (Android) and switches downloads to the chosen folder:
   * it's scanned for CBZ files, and downloads not in it are no longer listed (their
   * files stay in the old folder). Rejects with code CANCELLED if the picker is closed.
   */
  async chooseFolder(): Promise<PickedFolder> {
    await this.init().catch(() => undefined);
    const folder = await this.folders.pick();
    await this.sync().catch(() => undefined);
    this.kick();
    return folder;
  }

  /** Queues a gallery: saves its details and cover now, then its pages in the background. */
  async download(gallery: GalleryDetailResponse): Promise<void> {
    await this.init().catch(() => undefined);
    if (this.stateOf(gallery.id) !== null) {
      return;
    }
    await this.saved.saveGallery(gallery);
    await this.queue(gallery);
    this.kick();
  }

  /** Puts a failed download back in the queue; it resumes from the pages already saved. */
  async retry(id: number): Promise<void> {
    await this.db.run('UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ?', ['queued', Date.now(), id]);
    this.updateJob(id, { status: 'queued' });
    this.kick();
  }

  /** Stops a download (if running) and deletes its files. The gallery stays saved if it's a favorite. */
  async remove(id: number): Promise<void> {
    this.cancelled.add(id);
    this._jobs.update((jobs) => jobs.filter((job) => job.id !== id));
    this._downloaded.update((rows) => rows.filter((row) => row.id !== id));
    await this.deleteFiles(id);
    await this.forget(id);
  }

  /**
   * Unpacks a downloaded gallery's CBZ into a temporary folder for the reader and
   * returns image URLs by page number (empty if it isn't downloaded). Pages unpacked
   * for an earlier gallery are removed first. Call releasePages() when done reading.
   */
  async getPages(id: number): Promise<Map<number, string>> {
    await this.folders.load();
    const pages = new Map<number, string>();
    if (!this.folders.ready()) {
      return pages;
    }
    const root = this.folders.root();
    const entry = (await this.storage.list(root, [])).find((file) => file.type === 'file' && file.name === cbzName(id));
    if (!entry) {
      return pages;
    }
    await this.files.remove('reader');
    const dir = String(id);
    for (const file of readZip(await this.storage.readBytes(root, [], entry))) {
      const name = file.name.slice(file.name.lastIndexOf('/') + 1);
      const number = pageNumberOf(name);
      if (number !== null && !pages.has(number)) {
        pages.set(number, await this.files.write('reader', dir, name, bytesToBase64(await file.bytes())));
      }
    }
    return pages;
  }

  /** Deletes the pages unpacked for reading. */
  releasePages(id: number): Promise<void> {
    return this.files.remove('reader', String(id)).catch(() => undefined);
  }

  /**
   * After importing a backup the database describes another phone's downloads, so
   * they're reset and rebuilt from the CBZ files actually in the download folder.
   */
  async resetAfterImport(): Promise<void> {
    for (const job of this._jobs()) {
      this.cancelled.add(job.id);
    }
    this._jobs.set([]);
    this._downloaded.set([]);
    await this.db.run(
      `UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ?
       WHERE is_downloaded = 1 OR download_status IS NOT NULL`,
      [Date.now()],
    );
    await this.db.run('DELETE FROM saved_galleries WHERE is_favorite = 0');
    await this.files.remove('staging').catch(() => undefined);
    this.loadingDownloaded = null;
    await this.folders.load();
    await this.sync().catch(() => undefined);
    this.kick();
  }

  // --- Folder scan ---

  /**
   * Brings the database in line with the download folder: downloads whose CBZ is
   * gone are forgotten; CBZ files not known yet (copied from another phone) are added.
   * Gallery folders from the earlier one-folder-per-gallery format are converted.
   */
  private async sync(): Promise<void> {
    if (!this.folders.ready()) {
      return;
    }
    const root = this.folders.root();
    const entries = await this.storage.list(root, []);
    for (const folder of entries.filter((entry) => entry.type === 'directory' && /^\d+$/.test(entry.name))) {
      await this.convertFolder(root, Number(folder.name)).catch(() => undefined);
    }
    const cbzFiles = new Map<number, FolderEntry>();
    for (const entry of entries) {
      const match = entry.type === 'file' ? CBZ_FILE.exec(entry.name) : null;
      if (match) {
        cbzFiles.set(Number(match[1]), entry);
      }
    }
    this.loadingDownloaded = null;
    await this.loadDownloaded();
    for (const gallery of this._downloaded()) {
      if (!cbzFiles.has(gallery.id)) {
        await this.forget(gallery.id);
      }
    }
    const known = new Set([...this.downloadedIds(), ...this.activeIds()]);
    for (const [id, entry] of cbzFiles) {
      if (!known.has(id)) {
        await this.adopt(root, id, entry).catch(() => undefined);
      }
    }
    this.loadingDownloaded = null;
    await this.loadDownloaded();
  }

  /** Adds a CBZ file found in the folder, reading the details from its gallery.json. */
  private async adopt(root: string | null, id: number, entry: FolderEntry): Promise<void> {
    const files = readZip(await this.storage.readBytes(root, [], entry));
    let gallery = await this.saved.getDetails(id);
    if (!gallery?.pages) {
      // Not saved on this phone: the details come from the file (and the cover from the CDN, if online).
      const detailsFile = files.find((file) => file.name === DETAILS_FILE);
      gallery = detailsFile ? parseDetails(new TextDecoder().decode(await detailsFile.bytes()), id) : null;
      if (!gallery) {
        return;
      }
      if (!(await this.saved.saveGallery(gallery))) {
        // Offline: the first page stands in for the cover.
        const first = files
          .filter((file) => pageNumberOf(file.name) !== null)
          .sort((a, b) => pageNumberOf(a.name)! - pageNumberOf(b.name)!)[0];
        if (first) {
          const cover = `data:${mimeTypeOf(first.name)};base64,${bytesToBase64(await first.bytes())}`;
          await this.db.run('UPDATE saved_galleries SET cover_base64 = ? WHERE id = ? AND cover_base64 IS NULL', [cover, id]);
        }
      }
    }
    await this.markDownloaded(id);
  }

  /**
   * A gallery folder from the earlier format (`<id>/001.webp`…, visible in the
   * phone's gallery): its pages move to the app's private storage and it's queued,
   * so it's packed into a CBZ like any download. Then the folder is deleted.
   */
  private async convertFolder(root: string | null, id: number): Promise<void> {
    const path = [String(id)];
    let gallery = await this.saved.getDetails(id);
    if (!gallery?.pages) {
      gallery = parseDetails(base64ToText(await this.storage.read(root, path, DETAILS_FILE)), id);
      if (!gallery) {
        return;
      }
      await this.saved.saveGallery(gallery);
    }
    for (const entry of await this.storage.list(root, path)) {
      if (entry.type === 'file' && pageNumberOf(entry.name) !== null) {
        await this.files.write('staging', String(id), entry.name, await this.storage.read(root, path, entry.name));
      }
    }
    await this.db.run(
      'UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id],
    );
    if (!this.activeIds().has(id)) {
      await this.queue(gallery);
    }
    await this.storage.remove(root, path);
  }

  /** Pages of downloads that are no longer queued (e.g. removed while the app was closed). */
  private async removeOrphanedPages(): Promise<void> {
    const active = this.activeIds();
    for (const dir of await this.files.dirs('staging').catch(() => [])) {
      if (!active.has(Number(dir))) {
        await this.files.remove('staging', dir).catch(() => undefined);
      }
    }
  }

  // --- Worker ---

  /** Starts the worker unless it's already running (or there's no folder to save to yet). */
  private kick(): void {
    if (!this.folders.ready()) {
      return;
    }
    this.worker ??= this.work().finally(() => {
      this.worker = null;
      // Something may have been queued while the worker was finishing.
      if (this._jobs().some((job) => job.status === 'queued')) {
        this.kick();
      }
    });
  }

  private async work(): Promise<void> {
    let job: DownloadJob | undefined;
    while (this.folders.ready() && (job = this._jobs().find((candidate) => candidate.status === 'queued'))) {
      await this.downloadGallery(job.id);
    }
  }

  private async downloadGallery(id: number): Promise<void> {
    this.updateJob(id, { status: 'downloading' });
    const dir = String(id);
    try {
      const gallery = this.details.get(id) ?? (await this.saved.getDetails(id));
      if (!gallery) {
        throw new Error(`No saved details for gallery ${id}`);
      }
      await this.cdn.load();
      const done = await this.stagedPages(id);
      const pages = [...gallery.pages].sort((a, b) => a.number - b.number);
      this.updateJob(id, { totalPages: pages.length, downloadedPages: done.size });

      let first = true;
      for (const page of pages) {
        if (this.cancelled.has(id)) {
          return;
        }
        if (done.has(page.number)) {
          continue;
        }
        if (!first) {
          await this.sleep(this.pageDelay);
        }
        first = false;
        if (this.cancelled.has(id)) {
          return;
        }
        const data = await this.fetchPage(page.path);
        if (this.cancelled.has(id)) {
          return;
        }
        const name = pageFileName(page.number, pages.length, page.path);
        await this.files.write('staging', dir, name, data);
        done.set(page.number, name);
        this.updateJob(id, { downloadedPages: done.size });
      }
      if (this.cancelled.has(id)) {
        return;
      }

      await this.writeCbz(gallery, done);
      if (this.cancelled.has(id)) {
        await this.deleteFiles(id);
        return;
      }
      await this.markDownloaded(id);
      await this.files.remove('staging', dir).catch(() => undefined);
      this.details.delete(id);
      this._jobs.update((jobs) => jobs.filter((item) => item.id !== id));
      this.loadingDownloaded = null;
      await this.loadDownloaded().catch(() => undefined);
    } catch {
      if (!this.cancelled.has(id)) {
        await this.db
          .run('UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ?', ['failed', Date.now(), id])
          .catch(() => undefined);
        this.updateJob(id, { status: 'failed' });
      }
    }
  }

  /**
   * Packs the staged pages into `<id>.cbz`, one entry at a time (so a large gallery
   * is never in memory at once), under a temporary name renamed once it's complete.
   */
  private async writeCbz(gallery: GalleryDetailResponse, pages: Map<number, string>): Promise<void> {
    const root = this.folders.root();
    const part = partName(gallery.id);
    const zip = new ZipWriter();
    let started = false;
    const put = async (bytes: Uint8Array) => {
      const data = bytesToBase64(bytes);
      if (started) {
        await this.storage.append(root, [], part, data);
      } else {
        // Replaces a part left over from an interrupted attempt.
        await this.storage.write(root, [], part, data, 'application/octet-stream');
        started = true;
      }
    };
    const encoder = new TextEncoder();
    await put(zip.add(DETAILS_FILE, encoder.encode(JSON.stringify(gallery, null, 2))));
    await put(zip.add(COMIC_INFO_FILE, encoder.encode(comicInfoXml(gallery))));
    for (const number of [...pages.keys()].sort((a, b) => a - b)) {
      if (this.cancelled.has(gallery.id)) {
        return;
      }
      const name = pages.get(number)!;
      await put(zip.add(name, base64ToBytes(await this.files.read('staging', String(gallery.id), name))));
    }
    await put(zip.finish());
    await this.storage.rename(root, [], part, cbzName(gallery.id));
  }

  /** One page as base64, with a few attempts before giving up. */
  private async fetchPage(path: string): Promise<string> {
    const url = this.cdn.imageUrl(path);
    if (!url) {
      throw new Error('No image server for the page');
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      try {
        const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
        return stripDataUrl(await blobToDataUrl(blob));
      } catch (error) {
        lastError = error;
        if (attempt < PAGE_ATTEMPTS) {
          // Wait longer after each failure: a rate limit eases off with time.
          await this.sleep(this.pageDelay * attempt);
        }
      }
    }
    throw lastError;
  }

  // --- Database ---

  /** Marks a saved gallery as queued and adds it to the jobs. */
  private async queue(gallery: GalleryDetailResponse): Promise<void> {
    await this.db.run(
      'UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ? AND is_downloaded = 0',
      ['queued', Date.now(), gallery.id],
    );
    this.details.set(gallery.id, gallery);
    this.cancelled.delete(gallery.id);
    const staged = await this.stagedPages(gallery.id).catch(() => new Map<number, string>());
    this._jobs.update((jobs) => [
      ...jobs.filter((job) => job.id !== gallery.id),
      { id: gallery.id, title: titleOf(gallery), totalPages: gallery.pages.length, downloadedPages: staged.size, status: 'queued' },
    ]);
  }

  private async markDownloaded(id: number): Promise<void> {
    const now = Date.now();
    await this.db.run(
      'UPDATE saved_galleries SET is_downloaded = 1, downloaded_at = ?, download_status = NULL, updated_at = ? WHERE id = ?',
      [now, now, id],
    );
  }

  /** Clears the download state; the gallery row goes away unless it's a favorite. */
  private async forget(id: number): Promise<void> {
    await this.db.run(
      'UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id],
    );
    await this.db.run('DELETE FROM saved_galleries WHERE id = ? AND is_favorite = 0', [id]);
    this._downloaded.update((rows) => rows.filter((row) => row.id !== id));
  }

  private async restoreQueue(): Promise<void> {
    const rows = await this.db.query<QueueRow>(
      `SELECT id, title_english, title_pretty, num_pages, download_status, details_json
       FROM saved_galleries WHERE download_status IS NOT NULL ORDER BY updated_at`,
    );
    const jobs: DownloadJob[] = [];
    for (const row of rows) {
      let total = row.num_pages;
      try {
        total = (JSON.parse(row.details_json) as GalleryDetailResponse).pages.length || total;
      } catch {
        // Keep num_pages.
      }
      const staged = await this.stagedPages(row.id).catch(() => new Map<number, string>());
      jobs.push({
        id: row.id,
        title: row.title_english || row.title_pretty,
        totalPages: total,
        downloadedPages: staged.size,
        status: row.download_status,
      });
    }
    this._jobs.update((current) => [...jobs.filter((job) => !current.some((c) => c.id === job.id)), ...current]);
    await this.loadDownloaded().catch(() => undefined);
  }

  // --- Files ---

  /** Pages of a download in progress already saved, as file names by page number. */
  private async stagedPages(id: number): Promise<Map<number, string>> {
    const pages = new Map<number, string>();
    for (const name of await this.files.list('staging', String(id))) {
      const number = pageNumberOf(name);
      if (number !== null) {
        pages.set(number, name);
      }
    }
    return pages;
  }

  private async deleteFiles(id: number): Promise<void> {
    await this.files.remove('staging', String(id)).catch(() => undefined);
    await this.files.remove('reader', String(id)).catch(() => undefined);
    if (this.folders.ready()) {
      const root = this.folders.root();
      await this.storage.remove(root, [cbzName(id)]).catch(() => undefined);
      await this.storage.remove(root, [partName(id)]).catch(() => undefined);
    }
  }

  private updateJob(id: number, changes: Partial<DownloadJob>): void {
    this._jobs.update((jobs) => jobs.map((job) => (job.id === id ? { ...job, ...changes } : job)));
  }
}

function titleOf(gallery: GalleryDetailResponse): string {
  return gallery.title.english || gallery.title.pretty;
}

function parseDetails(json: string, id: number): GalleryDetailResponse | null {
  try {
    const details = JSON.parse(json) as GalleryDetailResponse;
    return details && details.id === id && Array.isArray(details.pages) ? details : null;
  } catch {
    return null;
  }
}


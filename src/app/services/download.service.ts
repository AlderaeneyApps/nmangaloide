import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CdnService, GalleryDetailResponse } from '../api';
import { DatabaseService } from '../sql-services/database.service';
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
 * Downloads galleries' pages into SQLite in the background while the app is open:
 * one gallery at a time, one page at a time, waiting DOWNLOAD_PAGE_DELAY between
 * pages. Progress is kept in the database, so unfinished downloads resume on the
 * next launch, picking up from the pages already saved.
 *
 * Downloads are independent from favorites: both live in `saved_galleries`
 * (with the details and cover), pages in `downloaded_pages`.
 */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly db = inject(DatabaseService);
  private readonly http = inject(HttpClient);
  private readonly cdn = inject(CdnService);
  private readonly saved = inject(SavedGalleriesService);
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

  /** Loads unfinished downloads from the database and resumes them. Safe to call repeatedly. */
  init(): Promise<void> {
    this.initializing ??= this.restoreQueue().then(
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

  /** Queues a gallery: saves its details and cover now, then its pages in the background. */
  async download(gallery: GalleryDetailResponse): Promise<void> {
    await this.init().catch(() => undefined);
    if (this.stateOf(gallery.id) !== null) {
      return;
    }
    await this.saved.saveGallery(gallery);
    await this.db.run(
      'UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ? AND is_downloaded = 0',
      ['queued', Date.now(), gallery.id],
    );
    this.details.set(gallery.id, gallery);
    this.cancelled.delete(gallery.id);
    const saved = await this.savedPageNumbers(gallery.id);
    this._jobs.update((jobs) => [
      ...jobs,
      { id: gallery.id, title: titleOf(gallery), totalPages: gallery.pages.length, downloadedPages: saved.size, status: 'queued' },
    ]);
    this.kick();
  }

  /** Puts a failed download back in the queue; it resumes from the pages already saved. */
  async retry(id: number): Promise<void> {
    await this.db.run('UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ?', ['queued', Date.now(), id]);
    this.updateJob(id, { status: 'queued' });
    this.kick();
  }

  /** Stops a download (if running) and removes it with its pages. The gallery stays if it's a favorite. */
  async remove(id: number): Promise<void> {
    this.cancelled.add(id);
    this._jobs.update((jobs) => jobs.filter((job) => job.id !== id));
    this._downloaded.update((rows) => rows.filter((row) => row.id !== id));
    await this.db.run('DELETE FROM downloaded_pages WHERE gallery_id = ?', [id]);
    await this.db.run(
      'UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id],
    );
    await this.db.run('DELETE FROM saved_galleries WHERE id = ? AND is_favorite = 0', [id]);
  }

  /** The pages saved for a gallery, as `data:` URLs by page number (empty if none). */
  async getPages(id: number): Promise<Map<number, string>> {
    const rows = await this.db.query<{ page_number: number; data_base64: string }>(
      'SELECT page_number, data_base64 FROM downloaded_pages WHERE gallery_id = ? ORDER BY page_number',
      [id],
    );
    return new Map(rows.map((row) => [row.page_number, row.data_base64]));
  }

  /**
   * Backups leave out the page images (they can be huge), so after importing one
   * the downloads are cleared and galleries kept only for being downloaded go away.
   */
  async resetAfterImport(): Promise<void> {
    this.cancelled.clear();
    this._jobs.set([]);
    this._downloaded.set([]);
    await this.db.run('DELETE FROM downloaded_pages');
    await this.db.run(
      `UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ?
       WHERE is_downloaded = 1 OR download_status IS NOT NULL`,
      [Date.now()],
    );
    await this.db.run('DELETE FROM saved_galleries WHERE is_favorite = 0');
    this.loadingDownloaded = null;
  }

  /** Starts the worker unless it's already running. */
  private kick(): void {
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
    while ((job = this._jobs().find((candidate) => candidate.status === 'queued'))) {
      await this.downloadGallery(job.id);
    }
  }

  private async downloadGallery(id: number): Promise<void> {
    this.updateJob(id, { status: 'downloading' });
    try {
      const gallery = this.details.get(id) ?? (await this.saved.getDetails(id));
      if (!gallery) {
        throw new Error(`No saved details for gallery ${id}`);
      }
      await this.cdn.load();
      const done = await this.savedPageNumbers(id);
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
        await this.db.run(
          `INSERT OR REPLACE INTO downloaded_pages (gallery_id, page_number, data_base64, width, height, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, page.number, data, page.width, page.height, Date.now()],
        );
        done.add(page.number);
        this.updateJob(id, { downloadedPages: done.size });
      }

      const now = Date.now();
      await this.db.run(
        'UPDATE saved_galleries SET is_downloaded = 1, downloaded_at = ?, download_status = NULL, updated_at = ? WHERE id = ?',
        [now, now, id],
      );
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

  /** One page as a `data:` URL, with a few attempts before giving up. */
  private async fetchPage(path: string): Promise<string> {
    const url = this.cdn.imageUrl(path);
    if (!url) {
      throw new Error('No image server for the page');
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      try {
        const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
        return await blobToDataUrl(blob);
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
      const saved = await this.savedPageNumbers(row.id);
      jobs.push({
        id: row.id,
        title: row.title_english || row.title_pretty,
        totalPages: total,
        downloadedPages: saved.size,
        status: row.download_status,
      });
    }
    this._jobs.update((current) => [...jobs.filter((job) => !current.some((c) => c.id === job.id)), ...current]);
    await this.loadDownloaded().catch(() => undefined);
  }

  private async savedPageNumbers(id: number): Promise<Set<number>> {
    const rows = await this.db.query<{ page_number: number }>(
      'SELECT page_number FROM downloaded_pages WHERE gallery_id = ?',
      [id],
    );
    return new Set(rows.map((row) => row.page_number));
  }

  private updateJob(id: number, changes: Partial<DownloadJob>): void {
    this._jobs.update((jobs) => jobs.map((job) => (job.id === id ? { ...job, ...changes } : job)));
  }
}

function titleOf(gallery: GalleryDetailResponse): string {
  return gallery.title.english || gallery.title.pretty;
}

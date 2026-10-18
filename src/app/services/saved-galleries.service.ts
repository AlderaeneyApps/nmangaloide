import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CdnService, GalleryDetailResponse, GalleryListItem } from '../api';
import { DatabaseService } from '../sql-services/database.service';

/**
 * A row of the `saved_galleries` table, without the large columns
 * (`details_json`, `downloaded_files`), which are read only when needed.
 */
export interface SavedGallery {
  id: number;
  media_id: string;
  title_english: string;
  title_japanese: string | null;
  title_pretty: string;
  num_pages: number;
  num_favorites: number;
  upload_date: number;
  cover_path: string | null;
  cover_width: number;
  cover_height: number;
  /** The cover as a `data:` URL, so it shows without the network. */
  cover_base64: string | null;
  is_favorite: number;
  favorited_at: number | null;
  is_downloaded: number;
  downloaded_at: number | null;
}

export const SUMMARY_COLUMNS = [
  'id',
  'media_id',
  'title_english',
  'title_japanese',
  'title_pretty',
  'num_pages',
  'num_favorites',
  'upload_date',
  'cover_path',
  'cover_width',
  'cover_height',
  'cover_base64',
  'is_favorite',
  'favorited_at',
  'is_downloaded',
  'downloaded_at',
].join(', ');

/** The summary columns of a gallery about to be saved (not a favorite or download yet). */
export function summaryOf(gallery: GalleryDetailResponse, cover: string | null): SavedGallery {
  return {
    id: gallery.id,
    media_id: gallery.media_id,
    title_english: gallery.title.english,
    title_japanese: gallery.title.japanese ?? null,
    title_pretty: gallery.title.pretty,
    num_pages: gallery.num_pages,
    num_favorites: gallery.num_favorites,
    upload_date: gallery.upload_date,
    cover_path: gallery.cover.path,
    cover_width: gallery.cover.width,
    cover_height: gallery.cover.height,
    cover_base64: cover,
    is_favorite: 0,
    favorited_at: null,
    is_downloaded: 0,
    downloaded_at: null,
  };
}

/** A saved gallery as the gallery card expects it (the cover comes from `cover_base64`). */
export function toGalleryListItem(saved: SavedGallery): GalleryListItem {
  return {
    id: saved.id,
    media_id: saved.media_id,
    english_title: saved.title_english || saved.title_pretty,
    japanese_title: saved.title_japanese,
    thumbnail: saved.cover_path ?? '',
    thumbnail_width: saved.cover_width,
    thumbnail_height: saved.cover_height,
    num_pages: saved.num_pages,
    num_favorites: saved.num_favorites,
    tag_ids: [],
    blacklisted: false,
  };
}

/**
 * Galleries kept on the device, in the `saved_galleries` SQLite table:
 * favorites now, downloads later (the table already has columns for them).
 */
@Injectable({ providedIn: 'root' })
export class SavedGalleriesService {
  private readonly db = inject(DatabaseService);
  private readonly http = inject(HttpClient);
  private readonly cdn = inject(CdnService);

  private readonly _favorites = signal<SavedGallery[]>([]);
  private loading: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  /** Favorites, most recently added first. */
  readonly favorites = this._favorites.asReadonly();
  readonly favoriteIds = computed(() => new Set(this._favorites().map((gallery) => gallery.id)));

  /** Reads the favorites from the database (once; later calls reuse the result). */
  load(): Promise<void> {
    this.loading ??= this.db
      .query<SavedGallery>(
        `SELECT ${SUMMARY_COLUMNS} FROM saved_galleries WHERE is_favorite = 1 ORDER BY favorited_at DESC`,
      )
      .then(
        (rows) => this._favorites.set(rows),
        (error) => {
          this.loading = null;
          throw error;
        },
      );
    return this.loading;
  }

  /** Re-reads the favorites, e.g. after a backup was imported. */
  reload(): Promise<void> {
    this.loading = null;
    return this.load();
  }

  isFavorite(id: number): boolean {
    return this.favoriteIds().has(id);
  }

  /** The full details saved with a gallery, or null when it isn't saved. */
  async getDetails(id: number): Promise<GalleryDetailResponse | null> {
    const [row] = await this.db.query<{ details_json: string }>(
      'SELECT details_json FROM saved_galleries WHERE id = ?',
      [id],
    );
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.details_json) as GalleryDetailResponse;
    } catch {
      return null;
    }
  }

  /** Adds or removes the gallery from the favorites. Resolves with whether it's a favorite now. */
  toggleFavorite(gallery: GalleryDetailResponse): Promise<boolean> {
    return this.enqueue(async () => {
      await this.load();
      if (this.isFavorite(gallery.id)) {
        await this.writeRemove(gallery.id);
        return false;
      }
      await this.writeAdd(gallery);
      return true;
    });
  }

  addFavorite(gallery: GalleryDetailResponse): Promise<void> {
    return this.enqueue(() => this.writeAdd(gallery));
  }

  removeFavorite(id: number): Promise<void> {
    return this.enqueue(() => this.writeRemove(id));
  }

  /**
   * Saves the gallery's details and its cover (as base64) on the device, without
   * changing whether it's a favorite or downloaded. Shared by favorites and downloads.
   * Resolves with the saved cover (or null if it couldn't be fetched).
   */
  async saveGallery(gallery: GalleryDetailResponse): Promise<string | null> {
    const cover = await this.downloadCover(gallery.cover.path);
    await this.db.run(
      `INSERT INTO saved_galleries (
         id, media_id, title_english, title_japanese, title_pretty, num_pages, num_favorites, upload_date,
         details_json, cover_path, cover_width, cover_height, cover_base64, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         media_id = excluded.media_id, title_english = excluded.title_english,
         title_japanese = excluded.title_japanese, title_pretty = excluded.title_pretty,
         num_pages = excluded.num_pages, num_favorites = excluded.num_favorites,
         upload_date = excluded.upload_date, details_json = excluded.details_json,
         cover_path = excluded.cover_path, cover_width = excluded.cover_width, cover_height = excluded.cover_height,
         cover_base64 = COALESCE(excluded.cover_base64, saved_galleries.cover_base64),
         updated_at = excluded.updated_at`,
      [
        gallery.id,
        gallery.media_id,
        gallery.title.english,
        gallery.title.japanese ?? null,
        gallery.title.pretty,
        gallery.num_pages,
        gallery.num_favorites,
        gallery.upload_date,
        JSON.stringify(gallery),
        gallery.cover.path,
        gallery.cover.width,
        gallery.cover.height,
        cover,
        Date.now(),
      ],
    );
    return cover;
  }

  private async writeAdd(gallery: GalleryDetailResponse): Promise<void> {
    const cover = await this.saveGallery(gallery);
    const now = Date.now();
    await this.db.run('UPDATE saved_galleries SET is_favorite = 1, favorited_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      gallery.id,
    ]);
    const saved: SavedGallery = {
      ...summaryOf(gallery, cover),
      is_favorite: 1,
      favorited_at: now,
    };
    this._favorites.update((current) => [saved, ...current.filter((item) => item.id !== gallery.id)]);
  }

  /** Clears the favorite flag; the row is deleted unless the gallery is (being) downloaded. */
  private async writeRemove(id: number): Promise<void> {
    await this.db.run(
      'DELETE FROM saved_galleries WHERE id = ? AND is_downloaded = 0 AND download_status IS NULL',
      [id],
    );
    await this.db.run(
      'UPDATE saved_galleries SET is_favorite = 0, favorited_at = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id],
    );
    this._favorites.update((current) => current.filter((item) => item.id !== id));
  }

  /** The cover as a `data:` URL, or null if it can't be fetched (the card then uses the CDN). */
  private async downloadCover(path: string): Promise<string | null> {
    try {
      await this.cdn.load();
      const url = this.cdn.thumbnailUrl(path);
      if (!url) {
        return null;
      }
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work);
    this.writes = result.catch(() => undefined);
    return result;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

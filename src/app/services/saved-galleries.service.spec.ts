import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GalleryDetailResponse } from '../api';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { SavedGalleriesService, flagLanguageOf, toGalleryListItem } from './saved-galleries.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const API = 'https://nhentai.net/api/v2';
const COVER_URL = 'https://t.example/galleries/100/cover.webp';

const GALLERY: GalleryDetailResponse = {
  id: 42,
  media_id: '100',
  title: { english: 'An English title', japanese: '日本語', pretty: 'Pretty title' },
  cover: { path: 'galleries/100/cover.webp', width: 350, height: 500 },
  thumbnail: { path: 'galleries/100/thumb.webp', width: 250, height: 350 },
  scanlator: '',
  upload_date: 1700000000,
  tags: [{ id: 1, name: 'yuri', slug: 'yuri', type: 'tag', url: '/tag/yuri/', count: 5 }],
  num_pages: 3,
  num_favorites: 7,
  pages: [],
};

describe('SavedGalleriesService', () => {
  let db: FakeDatabase;
  let http: HttpTestingController;
  let service: SavedGalleriesService;

  beforeEach(() => {
    db = new FakeDatabase();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideFakeDatabase(db)],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SavedGalleriesService);
  });

  afterEach(() => http.verify());

  const tick = () => new Promise((resolve) => setTimeout(resolve));

  /** Answers the CDN config and the cover image requests made while favoriting. */
  async function answerCover(cover: Blob | 'fail' = new Blob(['img'], { type: 'image/webp' })) {
    await tick();
    http.match(`${API}/cdn`).forEach((req) => req.flush({ thumb_servers: ['https://t.example'], image_servers: [] }));
    await tick();
    const req = http.expectOne(COVER_URL);
    expect(req.request.responseType).toBe('blob');
    if (cover === 'fail') {
      req.error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    } else {
      req.flush(cover);
    }
  }

  it('saves the details and the cover as base64 in one row when favoriting', async () => {
    const adding = service.addFavorite(GALLERY);
    await answerCover();
    await adding;

    const row = db.saved.get(42)!;
    expect(row).toMatchObject({
      media_id: '100',
      title_english: 'An English title',
      title_japanese: '日本語',
      title_pretty: 'Pretty title',
      num_pages: 3,
      num_favorites: 7,
      cover_path: 'galleries/100/cover.webp',
      cover_width: 350,
      cover_height: 500,
      is_favorite: 1,
      is_downloaded: 0,
      downloaded_files: null,
    });
    expect(row['cover_base64']).toBe(`data:image/webp;base64,${btoa('img')}`);
    expect(JSON.parse(row['details_json'] as string)).toEqual(GALLERY);
    expect(service.isFavorite(42)).toBe(true);
    expect(service.favorites()[0].cover_base64).toContain('data:image/webp;base64,');
  });

  it('still saves the favorite when the cover cannot be fetched', async () => {
    const adding = service.addFavorite(GALLERY);
    await answerCover('fail');
    await adding;
    expect(db.saved.get(42)).toMatchObject({ is_favorite: 1, cover_base64: null });
  });

  it('removes a favorite that is not downloaded', async () => {
    db.seedSaved({ id: 42 });
    await service.load();
    await service.removeFavorite(42);
    expect(db.saved.has(42)).toBe(false);
    expect(service.isFavorite(42)).toBe(false);
  });

  it('keeps a downloaded gallery and its files when it stops being a favorite', async () => {
    db.seedSaved({ id: 42, is_downloaded: 1, downloaded_files: '["data:image/webp;base64,AAA"]' });
    await service.load();
    await service.removeFavorite(42);
    expect(db.saved.get(42)).toMatchObject({ is_favorite: 0, is_downloaded: 1, downloaded_files: '["data:image/webp;base64,AAA"]' });
    expect(service.favorites()).toEqual([]);
  });

  it('toggles between favorite and not', async () => {
    const first = service.toggleFavorite(GALLERY);
    await answerCover();
    expect(await first).toBe(true);
    expect(await service.toggleFavorite(GALLERY)).toBe(false);
    expect(db.saved.has(42)).toBe(false);
  });

  it('lists favorites newest first and skips downloads that are not favorites', async () => {
    db.seedSaved({ id: 1, favorited_at: 100 });
    db.seedSaved({ id: 2, favorited_at: 300 });
    db.seedSaved({ id: 3, is_favorite: 0, favorited_at: null, is_downloaded: 1 });
    await service.load();
    expect(service.favorites().map((gallery) => gallery.id)).toEqual([2, 1]);
    // The big columns stay in the database.
    expect(service.favorites()[0]).not.toHaveProperty('details_json');
    expect(service.favorites()[0]).not.toHaveProperty('downloaded_files');
  });

  it('reads the saved details of a gallery', async () => {
    db.seedSaved({ id: 42, details_json: JSON.stringify(GALLERY) });
    expect(await service.getDetails(42)).toEqual(GALLERY);
    expect(await service.getDetails(7)).toBeNull();
  });

  it('turns a saved gallery into what the gallery card shows', () => {
    expect(
      toGalleryListItem({
        id: 42,
        media_id: '100',
        title_english: 'English',
        title_japanese: null,
        title_pretty: 'Pretty',
        num_pages: 3,
        num_favorites: 7,
        upload_date: 0,
        cover_path: 'galleries/100/cover.webp',
        cover_width: 350,
        cover_height: 500,
        cover_base64: 'data:x',
        is_favorite: 1,
        favorited_at: 1,
        is_downloaded: 0,
        downloaded_at: null,
        language: 'english',
      }),
    ).toMatchObject({ id: 42, english_title: 'English', thumbnail: 'galleries/100/cover.webp', thumbnail_width: 350 });
  });

  describe('language', () => {
    const withLanguage = (name: string): GalleryDetailResponse => ({
      ...GALLERY,
      tags: [...GALLERY.tags, { id: 9, name, slug: name, type: 'language', url: `/language/${name}/`, count: 1 }],
    });

    it('saves the flag language with the gallery', async () => {
      let saving = service.saveGallery(withLanguage('japanese'));
      await answerCover();
      await saving;
      expect(db.saved.get(42)!['language']).toBe('japanese');
      saving = service.saveGallery(withLanguage('korean'));
      await answerCover();
      await saving;
      expect(db.saved.get(42)!['language']).toBe('');
    });

    it('fills the language of galleries saved before it was stored', async () => {
      db.seedSaved({ id: 1, details_json: JSON.stringify(withLanguage('chinese')) });
      db.seedSaved({ id: 2, details_json: JSON.stringify({ ...withLanguage('english'), id: 2 }) });
      db.seedSaved({ id: 3, details_json: 'not json' });
      db.seedSaved({ id: 4, details_json: JSON.stringify(GALLERY), language: 'japanese' });
      await service.load();
      expect([1, 2, 3, 4].map((id) => db.saved.get(id)!['language'])).toEqual(['chinese', 'english', '', 'japanese']);
      expect(flagLanguageOf(service.favorites().find((g) => g.id === 1)!)).toBe('chinese');
      expect(flagLanguageOf({ language: '' })).toBeNull();
    });
  });
});

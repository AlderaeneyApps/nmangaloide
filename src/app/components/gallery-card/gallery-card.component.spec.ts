import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { CdnService, GalleryListItem, resolveMediaUrl } from '../../api';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { GalleryCardComponent, MAX_TITLE_LENGTH, truncateTitle } from './gallery-card.component';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const GALLERY: GalleryListItem = {
  id: 1,
  media_id: '100',
  english_title: 'A very long gallery title that should be clamped to two lines',
  japanese_title: null,
  thumbnail: 'galleries/100/thumb.webp',
  thumbnail_width: 250,
  thumbnail_height: 350,
  num_pages: 20,
  num_favorites: 5,
  tag_ids: [],
  blacklisted: false,
};

describe('GalleryCardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  /** Renders a card, after loading the CDN servers when `thumbServers` is given. */
  async function create(gallery: GalleryListItem, thumbServers: string[] | null) {
    if (thumbServers) {
      const loaded = TestBed.inject(CdnService).load();
      TestBed.inject(HttpTestingController)
        .expectOne('https://nhentai.net/api/v2/cdn')
        .flush({ thumb_servers: thumbServers, image_servers: [] });
      await loaded;
    }
    const fixture = TestBed.createComponent(GalleryCardComponent);
    fixture.componentRef.setInput('gallery', gallery);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  describe('language flag', () => {
    const flag = (el: HTMLElement) => el.querySelector('img.language-flag') as HTMLImageElement | null;

    it('shows a small flag for Japanese, Chinese and English galleries', async () => {
      for (const [id, language, src, name] of [
        [6346, 'japanese', '/assets/flags/jp.svg', 'Japanese'],
        [29963, 'chinese', '/assets/flags/cn.svg', 'Chinese'],
        [12227, 'english', '/assets/flags/gb.svg', 'English'],
      ] as const) {
        const el = await create({ ...GALLERY, tag_ids: [5, id, 17] }, null);
        expect(flag(el)?.getAttribute('src')).toBe(src);
        expect(flag(el)?.dataset['language']).toBe(language);
        expect(flag(el)?.getAttribute('alt')).toBe(name);
        // In the cover, which holds it in its top right corner.
        expect(flag(el)?.parentElement?.classList).toContain('cover');
      }
    });

    it('shows no flag for other languages', async () => {
      expect(flag(await create({ ...GALLERY, tag_ids: [5, 17] }, null))).toBeNull();
    });

    it('uses the language given by the page (saved galleries have no tag ids)', async () => {
      const fixture = TestBed.createComponent(GalleryCardComponent);
      fixture.componentRef.setInput('gallery', GALLERY);
      fixture.componentRef.setInput('language', 'chinese');
      fixture.detectChanges();
      expect(flag(fixture.nativeElement)?.dataset['language']).toBe('chinese');
      fixture.componentRef.setInput('language', null);
      fixture.detectChanges();
      expect(flag(fixture.nativeElement)).toBeNull();
    });
  });

  it('should show the thumbnail from the CDN and the title', async () => {
    const el = await create(GALLERY, ['https://t1.example.net']);
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://t1.example.net/galleries/100/thumb.webp');
    expect(img.getAttribute('alt')).toBe(GALLERY.english_title);
    const title = el.querySelector('.title')!;
    // Cut to MAX_TITLE_LENGTH characters, with the full title kept in the tooltip.
    expect(title.textContent?.trim()).toBe(`${GALLERY.english_title.slice(0, MAX_TITLE_LENGTH).trimEnd()}...`);
    expect(title.getAttribute('title')).toBe(GALLERY.english_title);
  });

  it('should reserve space using the thumbnail size', async () => {
    const el = await create(GALLERY, ['https://t1.example.net']);
    expect((el.querySelector('.cover') as HTMLElement).style.aspectRatio).toBe('250 / 350');
  });

  it('can show a saved cover instead of the CDN thumbnail', async () => {
    const fixture = TestBed.createComponent(GalleryCardComponent);
    fixture.componentRef.setInput('gallery', GALLERY);
    fixture.componentRef.setInput('coverSrc', 'data:image/webp;base64,AAA');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('data:image/webp;base64,AAA');
  });

  it('should not render an image until the CDN servers are known', async () => {
    const el = await create(GALLERY, null);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.title')?.textContent).toContain('A very long');
  });

  it('should fall back to the Japanese title', async () => {
    const el = await create({ ...GALLERY, english_title: '', japanese_title: '日本語のタイトル' }, ['t1.example.net']);
    expect(el.querySelector('.title')?.textContent?.trim()).toBe('日本語のタイトル');
  });
});

describe('resolveMediaUrl', () => {
  it('keeps absolute URLs', () => {
    expect(resolveMediaUrl('https://cdn.example/x.jpg', ['https://t1'])).toBe('https://cdn.example/x.jpg');
    expect(resolveMediaUrl('//cdn.example/x.jpg', [])).toBe('https://cdn.example/x.jpg');
  });

  it('joins relative paths to the first server', () => {
    expect(resolveMediaUrl('/a/b.jpg', ['https://t1.example/'])).toBe('https://t1.example/a/b.jpg');
    expect(resolveMediaUrl('a/b.jpg', ['t1.example'])).toBe('https://t1.example/a/b.jpg');
  });

  it('returns null without a path or servers', () => {
    expect(resolveMediaUrl('', ['https://t1'])).toBeNull();
    expect(resolveMediaUrl('a.jpg', [])).toBeNull();
    expect(resolveMediaUrl('a.jpg', undefined)).toBeNull();
  });
});

describe('truncateTitle', () => {
  it('keeps titles of up to MAX_TITLE_LENGTH characters', () => {
    const exact = 'x'.repeat(MAX_TITLE_LENGTH);
    expect(truncateTitle(exact)).toBe(exact);
    expect(truncateTitle('Short title')).toBe('Short title');
    expect(truncateTitle('')).toBe('');
  });

  it('cuts longer titles to MAX_TITLE_LENGTH characters and adds three dots', () => {
    expect(MAX_TITLE_LENGTH).toBe(40);
    expect(truncateTitle('y'.repeat(MAX_TITLE_LENGTH + 1))).toBe('y'.repeat(MAX_TITLE_LENGTH) + '...');
    expect(truncateTitle('y'.repeat(12), 10)).toBe('y'.repeat(10) + '...');
  });

  it('drops a trailing space before the dots', () => {
    expect(truncateTitle(`${'a'.repeat(MAX_TITLE_LENGTH - 1)} more words`)).toBe(`${'a'.repeat(MAX_TITLE_LENGTH - 1)}...`);
    expect(truncateTitle('A title with a space right at the cut', 21)).toBe('A title with a space...');
  });

  it('counts each visible character once, including Japanese and emoji', () => {
    expect(truncateTitle('あ'.repeat(MAX_TITLE_LENGTH + 5))).toBe('あ'.repeat(MAX_TITLE_LENGTH) + '...');
    expect(truncateTitle('😀'.repeat(MAX_TITLE_LENGTH + 1))).toBe('😀'.repeat(MAX_TITLE_LENGTH) + '...');
  });
});

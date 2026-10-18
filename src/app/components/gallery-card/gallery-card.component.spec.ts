import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { CdnService, GalleryListItem, resolveMediaUrl } from '../../api';
import { GalleryCardComponent, truncateTitle } from './gallery-card.component';

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

  it('should show the thumbnail from the CDN and the title', async () => {
    const el = await create(GALLERY, ['https://t1.example.net']);
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://t1.example.net/galleries/100/thumb.webp');
    expect(img.getAttribute('alt')).toBe(GALLERY.english_title);
    const title = el.querySelector('.title')!;
    // Cut to 35 characters, with the full title kept in the tooltip.
    expect(title.textContent?.trim()).toBe('A very long gallery title that shou...');
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
  it('keeps titles of up to 35 characters', () => {
    const exactly35 = 'x'.repeat(35);
    expect(truncateTitle(exactly35)).toBe(exactly35);
    expect(truncateTitle('Short title')).toBe('Short title');
    expect(truncateTitle('')).toBe('');
  });

  it('cuts longer titles to 35 characters and adds three dots', () => {
    const result = truncateTitle('y'.repeat(36));
    expect(result).toBe('y'.repeat(35) + '...');
  });

  it('drops a trailing space before the dots', () => {
    expect(truncateTitle('A title with a space right at the cut and more')).toBe('A title with a space right at the c...');
    expect(truncateTitle(`${'a'.repeat(34)} more words`)).toBe(`${'a'.repeat(34)}...`);
  });

  it('counts each visible character once, including Japanese and emoji', () => {
    const japanese = 'あ'.repeat(40);
    expect(truncateTitle(japanese)).toBe('あ'.repeat(35) + '...');
    const emoji = '😀'.repeat(36);
    expect(truncateTitle(emoji)).toBe('😀'.repeat(35) + '...');
  });
});

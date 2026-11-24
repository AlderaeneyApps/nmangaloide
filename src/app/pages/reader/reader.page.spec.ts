import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { GalleryDetailResponse, PageInfo, TagResponse } from '../../api';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { ZipWriter, concat } from '../../native/cbz';
import { bytesToBase64 } from '../../native/encoding';
import { FakeAppFiles, FakeDownloadStorage, TEST_FOLDER, provideFakeDownloads } from '../../testing/fake-download-storage';

/** A downloaded gallery's CBZ with the given pages. */
function cbz(pages: number[]): string {
  const zip = new ZipWriter();
  const parts = pages.map((page) => zip.add(`00${page}.webp`, new TextEncoder().encode(`page ${page}`)));
  return bytesToBase64(concat([...parts, zip.finish()]));
}
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { IonContent } from '@ionic/angular';

import { ReaderPage } from './reader.page';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const API = 'https://nhentai.net/api/v2';

function tag(id: number, name: string, type: string): TagResponse {
  return { id, name, slug: name, type, url: `/${type}/${name}/`, count: id };
}

function page(number: number): PageInfo {
  return {
    number,
    path: `galleries/100/${number}.webp`,
    width: 1000,
    height: 1400,
    thumbnail: `galleries/100/${number}t.webp`,
    thumbnail_width: 200,
    thumbnail_height: 280,
  };
}

const GALLERY: GalleryDetailResponse = {
  id: 42,
  media_id: '100',
  title: { english: 'An English title', japanese: '日本語のタイトル', pretty: 'Pretty title' },
  cover: { path: 'galleries/100/cover.webp', width: 350, height: 500 },
  thumbnail: { path: 'galleries/100/thumb.webp', width: 250, height: 350 },
  scanlator: '',
  upload_date: 1700000000,
  tags: [
    tag(1, 'yuri', 'tag'),
    tag(2, 'full color', 'tag'),
    tag(3, 'someone', 'artist'),
    tag(4, 'a circle', 'group'),
    tag(5, 'original', 'parody'),
    tag(6, 'english', 'language'),
  ],
  num_pages: 3,
  num_favorites: 123,
  // Deliberately out of order: pages are shown sorted by number.
  pages: [page(2), page(1), page(3)],
};

describe('ReaderPage', () => {
  let fixture: ComponentFixture<ReaderPage>;
  let http: HttpTestingController;
  let db: FakeDatabase;
  let storage: FakeDownloadStorage;
  let appFiles: FakeAppFiles;

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(
    mode: 'scroll' | 'paged',
    startPage?: string,
    seed?: (storage: FakeDownloadStorage) => void,
    direction?: 'rtl' | 'ltr',
  ) {
    db = new FakeDatabase();
    storage = new FakeDownloadStorage();
    appFiles = new FakeAppFiles();
    seed?.(storage);
    db.settings.set('reader_mode', mode);
    if (direction) {
      db.settings.set('page_direction', direction);
    }
    await TestBed.configureTestingModule({
      imports: [ReaderPage, getTranslocoTestingModule()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        provideFakeDownloads(storage, undefined, true, appFiles),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReaderPage);
    fixture.componentRef.setInput('id', '42');
    if (startPage) {
      fixture.componentRef.setInput('page', startPage);
    }
    fixture.detectChanges();
    await settle();
    http.expectOne(`${API}/galleries/42`).flush(GALLERY);
    http.expectOne(`${API}/cdn`).flush({ thumb_servers: ['https://t.example'], image_servers: ['https://i.example'] });
    await settle();
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const images = () => [...el().querySelectorAll('img')].map((img) => img.getAttribute('src'));
  const counter = () => document.querySelector('ion-footer .counter')?.textContent?.trim() ?? el().querySelector('.counter')?.textContent?.trim();
  const button = (action: string) => el().querySelector(`[data-action="${action}"]`) as HTMLIonButtonElement;

  it('shows every page in order in infinite scroll mode', async () => {
    await open('scroll');
    expect(el().querySelector('[data-mode="scroll"]')).toBeTruthy();
    expect(images()).toEqual([
      'https://i.example/galleries/100/1.webp',
      'https://i.example/galleries/100/2.webp',
      'https://i.example/galleries/100/3.webp',
    ]);
    expect(el().querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(el().querySelector('ion-footer')).toBeNull();
  });

  it('shows one page at a time and moves with the buttons', async () => {
    await open('paged');
    expect(images()).toEqual(['https://i.example/galleries/100/1.webp']);
    expect(counter()).toBe('1 / 3');
    expect(button('previous').disabled).toBe(true);

    button('next').click();
    await settle();
    expect(images()).toEqual(['https://i.example/galleries/100/2.webp']);
    expect(counter()).toBe('2 / 3');

    button('next').click();
    await settle();
    expect(counter()).toBe('3 / 3');
    expect(button('next').disabled).toBe(true);

    button('previous').click();
    await settle();
    expect(counter()).toBe('2 / 3');
  });

  it('reads a downloaded gallery from its CBZ, unpacked to temporary files removed on leaving', async () => {
    await open('scroll', undefined, (fake) => fake.seed(TEST_FOLDER.uri, '42.cbz', cbz([1, 2])));
    await settle();
    expect(images()).toEqual([
      'app-src:reader/42/001.webp',
      'app-src:reader/42/002.webp',
      'https://i.example/galleries/100/3.webp',
    ]);
    expect(appFiles.keys('reader')).toEqual(['42/001.webp', '42/002.webp']);

    fixture.destroy();
    await vi.waitFor(() => expect(appFiles.keys('reader')).toEqual([]));
  });

  it('still removes the unpacked pages on leaving after loading again (Retry)', async () => {
    await open('scroll', undefined, (fake) => fake.seed(TEST_FOLDER.uri, '42.cbz', cbz([1, 2])));
    await settle();
    await fixture.componentInstance.load();
    await fixture.componentInstance.load();
    await settle();
    expect(appFiles.keys('reader')).toEqual(['42/001.webp', '42/002.webp']);

    fixture.destroy();
    await vi.waitFor(() => expect(appFiles.keys('reader')).toEqual([]));
  });

  it('drops a late answer for an earlier load', async () => {
    await open('paged');
    const reader = fixture.componentInstance;
    // Gallery 7 is still loading when the page loads gallery 42 again.
    const late = reader.load(7);
    await reader.load(42);
    http.expectOne(`${API}/galleries/7`).flush({ ...GALLERY, id: 7, title: { ...GALLERY.title, pretty: 'Other' } });
    await late;
    fixture.detectChanges();
    expect(el().querySelector('ion-title')?.textContent).toContain('Pretty title');
  });

  it('falls back to the CDN for a downloaded page that fails to load', async () => {
    await open('scroll', undefined, (fake) => fake.seed(TEST_FOLDER.uri, '42.cbz', cbz([1])));
    await settle();
    el().querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(images()[0]).toBe('https://i.example/galleries/100/1.webp');
  });

  it('turns the page when tapping the image: left third back, the rest forward', async () => {
    await open('paged');
    const area = el().querySelector('[data-mode="paged"]') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;

    area.dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(counter()).toBe('2 / 3');
    });

    area.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(counter()).toBe('1 / 3');
    });
  });

  it('mirrors the tap zones left to right: right third back, the rest forward', async () => {
    await open('paged', undefined, undefined, 'ltr');
    const area = el().querySelector('[data-mode="paged"]') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;

    area.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(counter()).toBe('2 / 3');
    });

    area.dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(counter()).toBe('1 / 3');
    });
  });

  it('swaps the bottom bar buttons left to right, arrows still pointing outward', async () => {
    const buttons = () =>
      ['previous', 'next'].map((action) => {
        const button = el().querySelector(`[data-action="${action}"]`)!;
        return [button.closest('ion-buttons')!.getAttribute('slot'), button.querySelector('ion-icon')!.getAttribute('name')];
      });
    await open('paged');
    expect(buttons()).toEqual([
      ['start', 'chevron-back-outline'],
      ['end', 'chevron-forward-outline'],
    ]);
    TestBed.resetTestingModule();
    await open('paged', undefined, undefined, 'ltr');
    expect(buttons()).toEqual([
      ['end', 'chevron-forward-outline'],
      ['start', 'chevron-back-outline'],
    ]);
  });

  it('mirrors the arrow keys left to right', async () => {
    await open('paged', undefined, undefined, 'ltr');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await settle();
    expect(counter()).toBe('2 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await settle();
    expect(counter()).toBe('1 / 3');
  });

  it('zooms in on a double tap and back out on another, without turning the page', async () => {
    await open('paged');
    const area = () => el().querySelector('[data-mode="paged"]') as HTMLElement;
    const doubleTap = () => {
      area().dispatchEvent(new MouseEvent('click', { clientX: 250, clientY: 100, bubbles: true }));
      area().dispatchEvent(new MouseEvent('click', { clientX: 252, clientY: 102, bubbles: true }));
    };

    doubleTap();
    await settle();
    expect(area().classList).toContain('zoomed');
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    expect(counter()).toBe('1 / 3');

    doubleTap();
    await settle();
    expect(area().classList).not.toContain('zoomed');
  });

  it('zooms the infinite scroll on a double tap', async () => {
    await open('scroll');
    const strip = () => el().querySelector('[data-mode="scroll"]') as HTMLElement;
    strip().dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    strip().dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    await settle();
    expect(strip().classList).toContain('zoomed');
  });

  it('resets the zoom when turning the page', async () => {
    await open('paged');
    const area = () => el().querySelector('[data-mode="paged"]') as HTMLElement;
    area().dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    area().dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    await settle();
    expect(area().classList).toContain('zoomed');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(area().classList).not.toContain('zoomed');
  });

  it('turns the page with the arrow keys', async () => {
    await open('paged');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await settle();
    expect(counter()).toBe('2 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await settle();
    expect(counter()).toBe('1 / 3');
  });

  it('starts the infinite scroll on a given page', async () => {
    const scrollToPoint = vi.spyOn(IonContent.prototype, 'scrollToPoint').mockResolvedValue(undefined);
    const scroller = document.createElement('div');
    vi.spyOn(IonContent.prototype, 'getScrollElement').mockResolvedValue(scroller);
    const tops = new Map([['1', 0], ['2', 700], ['3', 1400]]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: tops.get(this.dataset['page'] ?? '') ?? 0 } as DOMRect;
    });
    try {
      await open('scroll', '3');
      await vi.waitFor(() => expect(scrollToPoint).toHaveBeenCalledWith(0, 1400));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('can start on a given page, clamped to the gallery', async () => {
    await open('paged', '3');
    expect(counter()).toBe('3 / 3');
  });

  it('ignores an out-of-range start page', async () => {
    await open('paged', '99');
    expect(counter()).toBe('3 / 3');
  });

  describe('top bar in infinite scroll mode', () => {
    const header = () => el().querySelector('ion-header') as HTMLElement;
    async function scrollTo(scrollTop: number) {
      el().querySelector('ion-content')!.dispatchEvent(new CustomEvent('ionScroll', { detail: { scrollTop } }));
      await settle();
    }

    it('turns on scroll events only in infinite scroll mode', async () => {
      await open('scroll');
      expect((el().querySelector('ion-content') as HTMLIonContentElement).scrollEvents).toBe(true);
    });

    it('hides when scrolling down and comes back when scrolling up', async () => {
      await open('scroll');
      expect(header().classList.contains('hidden')).toBe(false);

      await scrollTo(400);
      expect(header().classList.contains('hidden')).toBe(true);
      await scrollTo(900);
      expect(header().classList.contains('hidden')).toBe(true);

      await scrollTo(850);
      expect(header().classList.contains('hidden')).toBe(false);

      await scrollTo(1200);
      expect(header().classList.contains('hidden')).toBe(true);
    });

    it('ignores tiny scroll jitter', async () => {
      await open('scroll');
      await scrollTo(400);
      await scrollTo(396);
      expect(header().classList.contains('hidden')).toBe(true);
    });

    it('always shows near the top', async () => {
      await open('scroll');
      await scrollTo(400);
      await scrollTo(30);
      expect(header().classList.contains('hidden')).toBe(false);
    });

    it('stays visible in one-page-at-a-time mode', async () => {
      await open('paged');
      expect((el().querySelector('ion-content') as HTMLIonContentElement).scrollEvents).toBe(false);
      await scrollTo(400);
      expect(header().classList.contains('hidden')).toBe(false);
    });
  });

  it('goes back to the gallery page it came from', async () => {
    await open('scroll');
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('previous');
    expect(back.fallback()).toBe('/gallery/42');
  });
});

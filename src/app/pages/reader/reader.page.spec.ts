import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { GalleryDetailResponse, PageInfo, TagResponse } from '../../api';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { ReaderPage } from './reader.page';

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

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(mode: 'scroll' | 'paged', startPage?: string) {
    db = new FakeDatabase();
    db.settings.set('reader_mode', mode);
    await TestBed.configureTestingModule({
      imports: [ReaderPage, getTranslocoTestingModule()],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFakeDatabase(db)],
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

  it('turns the page when tapping the image: left third back, the rest forward', async () => {
    await open('paged');
    const area = el().querySelector('[data-mode="paged"]') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;

    area.dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    await settle();
    expect(counter()).toBe('2 / 3');

    area.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    await settle();
    expect(counter()).toBe('1 / 3');
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

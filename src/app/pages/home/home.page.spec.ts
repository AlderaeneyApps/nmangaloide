import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GalleryListItem } from '../../api';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { HomePage } from './home.page';

const BASE = 'https://nhentai.net/api/v2';

function gallery(id: number): GalleryListItem {
  return {
    id,
    media_id: String(id),
    english_title: `Gallery ${id}`,
    japanese_title: null,
    thumbnail: `galleries/${id}/thumb.webp`,
    thumbnail_width: 250,
    thumbnail_height: 350,
    num_pages: 10,
    num_favorites: 0,
    tag_ids: [],
    blacklisted: false,
  };
}

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage, getTranslocoTestingModule()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** Lets the page's pending promises resolve, then re-renders. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushCdn() {
    http.expectOne(`${BASE}/cdn`).flush({ thumb_servers: ['https://t1.example.net'], image_servers: [] });
  }

  it('should show the title and a menu button', async () => {
    http.expectOne(`${BASE}/galleries?page=1&per_page=25`).flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
    flushCdn();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-menu-button')).toBeTruthy();
    expect(el.querySelector('ion-title')?.textContent).toContain('Home');
    expect(el.textContent).toContain('No galleries found.');
  });

  it('should load the newest galleries into cards', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [gallery(1), gallery(2)], num_pages: 3, per_page: 25, total: 60 });
    flushCdn();
    await settle();

    const cards = fixture.nativeElement.querySelectorAll('app-gallery-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Gallery 1');
    expect(cards[0].querySelector('img').getAttribute('src')).toBe('https://t1.example.net/galleries/1/thumb.webp');
    expect(fixture.nativeElement.querySelector('ion-infinite-scroll').disabled).toBe(false);
  });

  it('should append the next page when scrolling', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [gallery(1)], num_pages: 2, per_page: 25, total: 2 });
    flushCdn();
    await settle();

    const complete = vi.fn().mockResolvedValue(undefined);
    const more = (fixture.componentInstance as unknown as { loadMore(e: unknown): Promise<void> }).loadMore({
      target: { complete },
    });
    http
      .expectOne(`${BASE}/galleries?page=2&per_page=25`)
      .flush({ result: [gallery(2)], num_pages: 2, per_page: 25, total: 2 });
    await more;
    await settle();

    expect(fixture.nativeElement.querySelectorAll('app-gallery-card').length).toBe(2);
    expect(complete).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('ion-infinite-scroll').disabled).toBe(true);
  });

  it('should show an error with a retry button when loading fails', async () => {
    http.expectOne(`${BASE}/galleries?page=1&per_page=25`).flush('boom', { status: 500, statusText: 'Server Error' });
    flushCdn();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Could not load galleries.');
    el.querySelector('ion-button')!.click();
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [gallery(1)], num_pages: 1, per_page: 25, total: 1 });
    await settle();

    expect(el.querySelectorAll('app-gallery-card').length).toBe(1);
  });
});

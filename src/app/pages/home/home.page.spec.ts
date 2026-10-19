import { HttpRequest, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { NavController, Platform } from '@ionic/angular';

import { GalleryListItem } from '../../api';
import { TagPreferencesService } from '../../services/tag-preferences.service';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { HomePage } from './home.page';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideFakeDatabase(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    // The first request goes out once the saved tags have been read.
    await settle();
  });

  afterEach(() => http.verify());

  /** Lets the page's pending promises resolve, then re-renders. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushCdn() {
    http
      .expectOne(`${BASE}/cdn`)
      .flush({ thumb_servers: ['https://t1.example.net'], image_servers: [] });
  }

  it('should show the title and a menu button', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
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
      .flush({
        result: [gallery(1), gallery(2)],
        num_pages: 3,
        per_page: 25,
        total: 60,
      });
    flushCdn();
    await settle();

    const cards = fixture.nativeElement.querySelectorAll('app-gallery-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Gallery 1');
    expect(cards[0].querySelector('img').getAttribute('src')).toBe(
      'https://t1.example.net/galleries/1/thumb.webp',
    );
    expect(
      fixture.nativeElement.querySelector('ion-infinite-scroll').disabled,
    ).toBe(false);
    // Cards open the gallery page, which can come back here.
    expect(
      fixture.nativeElement.querySelector('a.card-link').getAttribute('href'),
    ).toBe('/gallery/1?from=%2F');
  });

  it('should append the next page when scrolling', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [gallery(1)], num_pages: 2, per_page: 25, total: 2 });
    flushCdn();
    await settle();

    const complete = vi.fn().mockResolvedValue(undefined);
    const more = (
      fixture.componentInstance as unknown as {
        loadMore(e: unknown): Promise<void>;
      }
    ).loadMore({
      target: { complete },
    });
    http
      .expectOne(`${BASE}/galleries?page=2&per_page=25`)
      .flush({ result: [gallery(2)], num_pages: 2, per_page: 25, total: 2 });
    await more;
    await settle();

    expect(
      fixture.nativeElement.querySelectorAll('app-gallery-card').length,
    ).toBe(2);
    expect(complete).toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('ion-infinite-scroll').disabled,
    ).toBe(true);
  });

  it('should show an error with a retry button when loading fails', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    flushCdn();
    await settle();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Could not load galleries.');
    (el.querySelector('.state ion-button') as HTMLElement).click();
    await settle();
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [gallery(1)], num_pages: 1, per_page: 25, total: 1 });
    await settle();

    expect(el.querySelectorAll('app-gallery-card').length).toBe(1);
  });

  describe('searching', () => {
    let navigateRoot: ReturnType<typeof vi.fn>;
    /** Matches a search request by its parameters (Angular leaves `:` unencoded in the URL). */
    const searchFor =
      (query: string, page: number) => (req: HttpRequest<unknown>) =>
        req.url === `${BASE}/search` &&
        req.params.get('query') === query &&
        req.params.get('sort') === 'date' &&
        req.params.get('page') === String(page);
    const SEARCH = (page: number) => searchFor('artist:"someone"', page);

    beforeEach(async () => {
      // Answer the newest-galleries load from the outer beforeEach.
      http
        .expectOne(`${BASE}/galleries?page=1&per_page=25`)
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();

      navigateRoot = vi.fn().mockResolvedValue(true);
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [HomePage, getTranslocoTestingModule()],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          { provide: NavController, useValue: { navigateRoot } },
          provideFakeDatabase(),
        ],
      }).compileComponents();
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(HomePage);
      fixture.componentRef.setInput('q', 'artist:"someone"');
      fixture.detectChanges();
    });

    it('shows the search results with the filter as a chip', async () => {
      http
        .expectOne(SEARCH(1))
        .flush({ result: [gallery(7)], num_pages: 1, per_page: 25, total: 1 });
      flushCdn();
      await settle();

      const el: HTMLElement = fixture.nativeElement;
      expect(
        el.querySelector('.search-filter ion-chip')?.textContent?.trim(),
      ).toBe('Artist: someone');
      expect(el.querySelectorAll('app-gallery-card').length).toBe(1);
      // Gallery pages come back to these results.
      const router = TestBed.inject(Router);
      const link = router.parseUrl(
        el.querySelector('a.card-link')!.getAttribute('href')!,
      );
      expect(
        router.serializeUrl(
          router.createUrlTree(
            link.root.children['primary'].segments.map((s) => s.path),
          ),
        ),
      ).toBe('/gallery/7');
      expect(router.parseUrl(link.queryParams['from']).queryParams['q']).toBe(
        'artist:"someone"',
      );
    });

    it('says when nothing matches', async () => {
      http
        .expectOne(SEARCH(1))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();
      expect(fixture.nativeElement.textContent).toContain(
        'No galleries match this search.',
      );
    });

    it('pages through the search results', async () => {
      http
        .expectOne(SEARCH(1))
        .flush({ result: [gallery(1)], num_pages: 2, per_page: 25, total: 2 });
      flushCdn();
      await settle();

      const complete = vi.fn().mockResolvedValue(undefined);
      const page = fixture.componentInstance as unknown as {
        loadMore(e: unknown): Promise<void>;
      };
      const more = page.loadMore({ target: { complete } });
      http
        .expectOne(SEARCH(2))
        .flush({ result: [gallery(2)], num_pages: 2, per_page: 25, total: 2 });
      await more;
      await settle();
      expect(
        fixture.nativeElement.querySelectorAll('app-gallery-card').length,
      ).toBe(2);
    });

    it('clears the search from the chip', async () => {
      http
        .expectOne(SEARCH(1))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();

      (
        fixture.nativeElement.querySelector(
          '.search-filter ion-chip',
        ) as HTMLElement
      ).click();
      expect(navigateRoot).toHaveBeenCalledWith(['/']);
    });

    it('reloads when the search changes and ignores the older results', async () => {
      const first = http.expectOne(SEARCH(1));
      fixture.componentRef.setInput('q', 'tag:"yuri"');
      fixture.detectChanges();
      await settle();
      const second = http.expectOne(searchFor('tag:"yuri"', 1));
      second.flush({
        result: [gallery(9)],
        num_pages: 1,
        per_page: 25,
        total: 1,
      });
      first.flush({
        result: [gallery(1), gallery(2)],
        num_pages: 1,
        per_page: 25,
        total: 2,
      });
      http
        .match(`${BASE}/cdn`)
        .forEach((req) =>
          req.flush({
            thumb_servers: ['https://t1.example.net'],
            image_servers: [],
          }),
        );
      await settle();

      const cards = fixture.nativeElement.querySelectorAll('app-gallery-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('Gallery 9');
      expect(
        fixture.nativeElement
          .querySelector('.search-filter ion-chip')
          ?.textContent?.trim(),
      ).toBe('Tag: yuri');
    });
  });

  describe('saved tags', () => {
    let db: FakeDatabase;
    const searchFor =
      (query: string, page = 1) =>
      (req: HttpRequest<unknown>) =>
        req.url === `${BASE}/search` &&
        req.params.get('query') === query &&
        req.params.get('page') === String(page);
    const SAVED = '-tag:"yaoi" tag:"yuri"';

    beforeEach(async () => {
      http
        .expectOne(`${BASE}/galleries?page=1&per_page=25`)
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();

      db = new FakeDatabase();
      db.seed({ id: 1, name: 'yuri', state: 'enabled' });
      db.seed({ id: 2, name: 'yaoi', state: 'disabled' });
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [HomePage, getTranslocoTestingModule()],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          provideFakeDatabase(db),
        ],
      }).compileComponents();
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(HomePage);
      fixture.detectChanges();
      await settle();
    });

    const el = () => fixture.nativeElement as HTMLElement;

    it('filters the home page by the saved tags instead of showing the newest galleries', async () => {
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [gallery(3)], num_pages: 1, per_page: 25, total: 1 });
      flushCdn();
      await settle();

      expect(el().querySelectorAll('app-gallery-card').length).toBe(1);
      const chip = el().querySelector(
        '[data-filter="saved-tags"]',
      ) as HTMLElement;
      expect(chip.textContent).toContain('Your tags (2)');
      expect(chip.getAttribute('aria-label')).toContain('saved tags');
      http.expectNone(`${BASE}/galleries?page=1&per_page=25`);
    });

    it('pages through the saved-tags results', async () => {
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [gallery(1)], num_pages: 2, per_page: 25, total: 2 });
      flushCdn();
      await settle();

      const complete = vi.fn().mockResolvedValue(undefined);
      const more = (
        fixture.componentInstance as unknown as {
          loadMore(e: unknown): Promise<void>;
        }
      ).loadMore({
        target: { complete },
      });
      http
        .expectOne(searchFor(SAVED, 2))
        .flush({ result: [gallery(2)], num_pages: 2, per_page: 25, total: 2 });
      await more;
      await settle();
      expect(el().querySelectorAll('app-gallery-card').length).toBe(2);
    });

    it('uses a search from a gallery tag instead, and goes back to the saved tags when it is cleared', async () => {
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();

      fixture.componentRef.setInput('q', 'artist:"someone"');
      fixture.detectChanges();
      await settle();
      http
        .expectOne(searchFor('artist:"someone"'))
        .flush({ result: [gallery(5)], num_pages: 1, per_page: 25, total: 1 });
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeNull();
      expect(
        el().querySelector('.search-filter ion-chip')?.textContent?.trim(),
      ).toBe('Artist: someone');

      fixture.componentRef.setInput('q', undefined);
      fixture.detectChanges();
      await settle();
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeTruthy();
    });

    it('picks up tag changes when the page is shown again, without reloading otherwise', async () => {
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();
      const page = fixture.componentInstance as unknown as {
        ionViewWillEnter(): void;
      };

      page.ionViewWillEnter();
      await settle();
      http.expectNone(() => true); // nothing changed

      await TestBed.inject(TagPreferencesService).setState(
        {
          id: 3,
          name: 'full color',
          slug: 'full-color',
          type: 'tag',
          count: 1,
        },
        'enabled',
      );
      await settle();
      http.expectNone(() => true); // not live: only when coming back to the page

      page.ionViewWillEnter();
      await settle();
      http
        .expectOne(searchFor('tag:"full color" -tag:"yaoi" tag:"yuri"'))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      await settle();
      expect(
        el().querySelector('[data-filter="saved-tags"]')?.textContent,
      ).toContain('Your tags (3)');
    });

    it('shows the newest galleries again once every tag is cleared', async () => {
      http
        .expectOne(searchFor(SAVED))
        .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
      flushCdn();
      await settle();

      const tags = TestBed.inject(TagPreferencesService);
      await tags.setState(
        { id: 1, name: 'yuri', slug: 'yuri', type: 'tag', count: 0 },
        null,
      );
      await tags.setState(
        { id: 2, name: 'yaoi', slug: 'yaoi', type: 'tag', count: 0 },
        null,
      );
      (
        fixture.componentInstance as unknown as { ionViewWillEnter(): void }
      ).ionViewWillEnter();
      await settle();

      http
        .expectOne(`${BASE}/galleries?page=1&per_page=25`)
        .flush({ result: [gallery(1)], num_pages: 1, per_page: 25, total: 1 });
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeNull();
      expect(el().querySelectorAll('app-gallery-card').length).toBe(1);
    });
  });

  describe('header search', () => {
    const searchFor =
      (query: string, page = 1) =>
      (req: HttpRequest<unknown>) =>
        req.url === `${BASE}/search` &&
        req.params.get('query') === query &&
        req.params.get('page') === String(page);
    const SAVED = 'tag:"yuri"';
    const NEWEST = `${BASE}/galleries?page=1&per_page=25`;
    const empty = { result: [], num_pages: 0, per_page: 25, total: 0 };
    let backHandler: ((next: () => void) => void) | null;

    /** A fresh page, optionally with saved tags and a `q` search. */
    async function open({
      savedTags = false,
      q,
    }: { savedTags?: boolean; q?: string } = {}) {
      http.expectOne(NEWEST).flush(empty);
      flushCdn();
      await settle();

      const db = new FakeDatabase();
      if (savedTags) {
        db.seed({ id: 1, name: 'yuri', state: 'enabled' });
      }
      backHandler = null;
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [HomePage, getTranslocoTestingModule()],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          provideFakeDatabase(db),
          {
            provide: Platform,
            useValue: {
              backButton: {
                subscribeWithPriority: (
                  _priority: number,
                  handler: (next: () => void) => void,
                ) => {
                  backHandler = handler;
                  return { unsubscribe: vi.fn() };
                },
              },
            },
          },
        ],
      }).compileComponents();
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(HomePage);
      if (q) {
        fixture.componentRef.setInput('q', q);
      }
      fixture.detectChanges();
      await settle();
    }

    const el = () => fixture.nativeElement as HTMLElement;
    const loupe = () =>
      el().querySelector('ion-toolbar [data-action="search"]') as HTMLElement;
    const field = () =>
      el().querySelector('[data-search="field"]') as HTMLElement | null;
    async function toggle() {
      loupe().click();
      await settle();
    }
    async function type(text: string) {
      field()!.dispatchEvent(
        new CustomEvent('ionInput', { detail: { value: text } }),
      );
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();
    }
    const titles = () =>
      [...el().querySelectorAll('app-gallery-card')].map((card) =>
        card.textContent?.trim(),
      );

    it('has a loupe on the right of the header that opens a search field in place of the title', async () => {
      await open();
      http.expectOne(NEWEST).flush(empty);
      flushCdn();
      await settle();

      expect(loupe().closest('ion-buttons')?.getAttribute('slot')).toBe('end');
      expect(loupe().dataset['state']).toBe('closed');
      expect(loupe().querySelector('ion-icon')?.getAttribute('name')).toBe(
        'search',
      );
      expect(field()).toBeNull();

      await toggle();
      expect(field()).toBeTruthy();
      expect((field() as HTMLIonSearchbarElement).placeholder).toBe(
        'Search galleries',
      );
      expect(
        el().querySelector('ion-header:not([collapse]) ion-title'),
      ).toBeNull();
      expect(loupe().dataset['state']).toBe('open');
      // Opening alone doesn't search.
      http.expectNone(() => true);
    });

    it('searches for the typed text, and goes back to the newest galleries when closed', async () => {
      await open();
      http
        .expectOne(NEWEST)
        .flush({ result: [gallery(1)], num_pages: 1, per_page: 25, total: 1 });
      flushCdn();
      await settle();

      await toggle();
      await type('  big cats ');
      http
        .expectOne(searchFor('big cats'))
        .flush({ result: [gallery(9)], num_pages: 2, per_page: 25, total: 2 });
      await settle();
      expect(titles()).toEqual(['Gallery 9']);
      expect(el().querySelector('a.card-link')?.getAttribute('href')).toBe(
        '/gallery/9?from=%2F%3Fq%3Dbig%2520cats',
      );

      // Scrolling pages through the typed search.
      const complete = vi.fn().mockResolvedValue(undefined);
      const more = (
        fixture.componentInstance as unknown as {
          loadMore(e: unknown): Promise<void>;
        }
      ).loadMore({
        target: { complete },
      });
      http
        .expectOne(searchFor('big cats', 2))
        .flush({ result: [gallery(10)], num_pages: 2, per_page: 25, total: 2 });
      await more;

      await toggle();
      expect(field()).toBeNull();
      http
        .expectOne(NEWEST)
        .flush({ result: [gallery(1)], num_pages: 1, per_page: 25, total: 1 });
      await settle();
      expect(titles()).toEqual(['Gallery 1']);

      // Opened again, the field is empty.
      await toggle();
      expect((field() as HTMLIonSearchbarElement).value ?? '').toBe('');
    });

    it('overrides the saved tags, and goes back to them when closed', async () => {
      await open({ savedTags: true });
      http.expectOne(searchFor(SAVED)).flush(empty);
      flushCdn();
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeTruthy();

      await toggle();
      await type('cats');
      http
        .expectOne(searchFor('cats'))
        .flush({ result: [gallery(4)], num_pages: 1, per_page: 25, total: 1 });
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeNull();

      await toggle();
      http.expectOne(searchFor(SAVED)).flush(empty);
      await settle();
      expect(el().querySelector('[data-filter="saved-tags"]')).toBeTruthy();
    });

    it('overrides a tag search from a gallery, and goes back to it when closed', async () => {
      await open({ q: 'artist:"someone"' });
      http.expectOne(searchFor('artist:"someone"')).flush(empty);
      flushCdn();
      await settle();
      expect(
        el().querySelector('.search-filter ion-chip')?.textContent?.trim(),
      ).toBe('Artist: someone');

      await toggle();
      await type('cats');
      http.expectOne(searchFor('cats')).flush(empty);
      await settle();
      expect(el().querySelector('.search-filter')).toBeNull();

      await toggle();
      http.expectOne(searchFor('artist:"someone"')).flush(empty);
      await settle();
      expect(
        el().querySelector('.search-filter ion-chip')?.textContent?.trim(),
      ).toBe('Artist: someone');
    });

    it('does nothing when closed without having searched, or when Enter is pressed on an empty field', async () => {
      await open();
      http.expectOne(NEWEST).flush(empty);
      flushCdn();
      await settle();

      await toggle();
      await type('   ');
      await toggle();
      http.expectNone(() => true);
    });

    it('is replaced by a new tag search from a gallery', async () => {
      await open();
      http.expectOne(NEWEST).flush(empty);
      flushCdn();
      await settle();
      await toggle();
      await type('cats');
      http.expectOne(searchFor('cats')).flush(empty);
      await settle();

      fixture.componentRef.setInput('q', 'tag:"yuri"');
      fixture.detectChanges();
      await settle();
      http.expectOne(searchFor('tag:"yuri"')).flush(empty);
      await settle();
      expect(field()).toBeNull();
    });

    it("closes with Android's back button before leaving the app", async () => {
      await open();
      http.expectOne(NEWEST).flush(empty);
      flushCdn();
      await settle();
      const next = vi.fn();

      await toggle();
      backHandler!(next);
      await settle();
      expect(field()).toBeNull();
      expect(next).not.toHaveBeenCalled();

      backHandler!(next);
      expect(next).toHaveBeenCalled();
    });
  });

  it('has no back button: it is where the others go back to', async () => {
    http
      .expectOne(`${BASE}/galleries?page=1&per_page=25`)
      .flush({ result: [], num_pages: 0, per_page: 25, total: 0 });
    flushCdn();
    await settle();
    expect(
      fixture.debugElement.query(By.directive(BackButtonComponent)),
    ).toBeNull();
  });
});

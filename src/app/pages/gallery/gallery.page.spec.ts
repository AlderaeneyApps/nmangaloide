import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { NavController } from '@ionic/angular';

import { GalleryDetailResponse, PageInfo, TagResponse } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { GalleryPage } from './gallery.page';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';

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

describe('GalleryPage', () => {
  let db: FakeDatabase;
  let fixture: ComponentFixture<GalleryPage>;
  let http: HttpTestingController;
  let navigateRoot: ReturnType<typeof vi.fn>;

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    db = new FakeDatabase();
    navigateRoot = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [GalleryPage, getTranslocoTestingModule()],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeDatabase(db),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NavController, useValue: { navigateRoot } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl('/gallery/42');
    fixture = TestBed.createComponent(GalleryPage);
    fixture.componentRef.setInput('id', '42');
    fixture.detectChanges();
    await settle();
  });

  afterEach(() => http.verify());

  function flush(gallery: GalleryDetailResponse = GALLERY) {
    http.expectOne(`${API}/galleries/42`).flush(gallery);
    http.expectOne(`${API}/cdn`).flush({ thumb_servers: ['https://t.example'], image_servers: ['https://i.example'] });
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows the cover, titles and facts', async () => {
    flush();
    await settle();

    expect(el().querySelector('ion-title')?.textContent).toContain('Pretty title');
    expect(el().querySelector('.english')?.textContent).toBe('An English title');
    expect(el().querySelector('.japanese')?.textContent).toBe('日本語のタイトル');
    expect(el().querySelector('.cover img')?.getAttribute('src')).toBe('https://t.example/galleries/100/cover.webp');
    const facts = el().querySelector('.facts')!.textContent!;
    expect(facts).toContain('3 pages');
    expect(facts).toContain('123 favorites');
    expect(facts).toContain('Uploaded');
    expect(facts).toContain('#42');
  });

  it('groups the tags: artists, groups and parodies first', async () => {
    flush();
    await settle();

    const groups = [...el().querySelectorAll('.tag-group')].map((section) => ({
      heading: section.querySelector('h2')?.textContent,
      tags: [...section.querySelectorAll('ion-label')].map((label) => label.textContent),
    }));
    expect(groups).toEqual([
      { heading: 'Artists', tags: ['someone'] },
      { heading: 'Groups', tags: ['a circle'] },
      { heading: 'Parodies', tags: ['original'] },
      { heading: 'Tags', tags: ['full color', 'yuri'] },
      { heading: 'Languages', tags: ['english'] },
    ]);
  });

  it('links to the reader from a floating button, coming back to this page', async () => {
    flush();
    await settle();

    // A floating button pinned to the bottom-right corner, outside the scrolling content.
    const fab = el().querySelector('ion-fab') as HTMLIonFabElement;
    expect(fab.getAttribute('slot')).toBe('fixed');
    expect(fab.vertical).toBe('bottom');
    expect(fab.horizontal).toBe('end');
    const read = fab.querySelector('ion-fab-button.read') as HTMLElement;
    // ion-fab-button moves the label onto the native link it renders.
    expect(read.shadowRoot!.querySelector('a.button-native')!.getAttribute('aria-label')).toBe('Read');
    read.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/gallery/42/read?from=%2Fgallery%2F42');
  });

  it('goes to the home page searching for a tapped artist, group or tag', async () => {
    flush();
    await settle();

    const chip = (type: string) => el().querySelector(`.tag-group[data-type="${type}"] ion-chip`) as HTMLElement;
    expect(chip('artist').getAttribute('aria-label')).toBe('Show galleries with someone');

    chip('artist').click();
    expect(navigateRoot).toHaveBeenLastCalledWith(['/'], { queryParams: { q: 'artist:"someone"' } });

    chip('group').click();
    expect(navigateRoot).toHaveBeenLastCalledWith(['/'], { queryParams: { q: 'group:"a circle"' } });

    chip('tag').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigateRoot).toHaveBeenLastCalledWith(['/'], { queryParams: { q: 'tag:"full color"' } });
  });

  it('shows an error with retry', async () => {
    http.expectOne(`${API}/galleries/42`).flush('boom', { status: 500, statusText: 'Server Error' });
    http.expectOne(`${API}/cdn`).flush({ thumb_servers: [], image_servers: [] });
    await settle();
    expect(el().textContent).toContain('Could not load this gallery.');

    (el().querySelector('.state ion-button') as HTMLElement).click();
    await settle();
    http.expectOne(`${API}/galleries/42`).flush(GALLERY);
    await settle();
    expect(el().querySelector('.english')?.textContent).toBe('An English title');
  });

  it('goes back to the previous page, or the home page when opened directly', async () => {
    flush();
    await settle();
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('previous');
    expect(back.fallback()).toBe('/');
  });

  describe('favorite button', () => {
    const heart = () => el().querySelector('ion-toolbar [data-action="favorite"]') as HTMLIonButtonElement;
    /** ion-button moves its aria-label onto the native button it renders. */
    const label = () => heart().shadowRoot?.querySelector('button')?.getAttribute('aria-label') ?? heart().getAttribute('aria-label');

    async function answerCover() {
      await settle();
      http.expectOne('https://t.example/galleries/100/cover.webp').flush(new Blob(['img'], { type: 'image/webp' }));
      await settle();
    }

    it('sits on the right of the header and starts as "add"', async () => {
      flush();
      await settle();
      expect(heart().closest('ion-buttons')?.getAttribute('slot')).toBe('end');
      expect(heart().dataset['state']).toBe('off');
      expect(label()).toBe('Add to favorites');
      expect(heart().querySelector('ion-icon')?.getAttribute('name')).toBe('heart-outline');
    });

    it('saves the gallery with its cover in the database, and removes it again', async () => {
      flush();
      await settle();

      heart().click();
      await answerCover();
      // Converting the cover to base64 is asynchronous; wait for the row to be written.
      await vi.waitFor(() => expect(db.saved.get(42)).toBeDefined());
      await settle();
      expect(db.saved.get(42)).toMatchObject({ is_favorite: 1, title_english: 'An English title' });
      expect(db.saved.get(42)!['cover_base64']).toContain('data:image/webp;base64,');
      expect(heart().dataset['state']).toBe('on');
      expect(label()).toBe('Remove from favorites');
      expect(heart().querySelector('ion-icon')?.getAttribute('name')).toBe('heart');

      heart().click();
      await settle();
      expect(db.saved.has(42)).toBe(false);
      expect(heart().dataset['state']).toBe('off');
      expect(label()).toBe('Add to favorites');
    });

    it('shows a favorite from the database without calling the API', async () => {
      // A fresh page for a gallery that is already a favorite.
      flush();
      await settle();
      db.seedSaved({ id: 7, details_json: JSON.stringify({ ...GALLERY, id: 7 }), cover_base64: 'data:image/webp;base64,AAA' });
      const other = TestBed.createComponent(GalleryPage);
      other.componentRef.setInput('id', '7');
      other.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      other.detectChanges();
      http.expectNone(`${API}/galleries/7`);
      expect(other.nativeElement.querySelector('.english')?.textContent).toBe('An English title');
    });
  });
});

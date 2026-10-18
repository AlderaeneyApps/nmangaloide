import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ToastController } from '@ionic/angular';

import { TagResponse } from '../../api';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { TagsPage, TagsTab } from './tags.page';

const API = 'https://nhentai.net/api/v2';
const listUrl = (type: string, page = 1) => `${API}/tags/${type}?sort=name&page=${page}&per_page=100`;

function tag(id: number, name: string, type = 'tag'): TagResponse {
  return { id, name, slug: name.replace(/ /g, '-'), type, url: `/${type}/${name}/`, count: id * 10 };
}

describe('TagsPage', () => {
  let db: FakeDatabase;
  let fixture: ComponentFixture<TagsPage>;
  let http: HttpTestingController;
  let toastCreate: ReturnType<typeof vi.fn>;

  async function setUp() {
    toastCreate = vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) });
    await TestBed.configureTestingModule({
      imports: [TagsPage, getTranslocoTestingModule()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        { provide: ToastController, useValue: { create: toastCreate } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TagsPage);
    fixture.detectChanges();
    await settle();
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = (tab: TagsTab) =>
    [...el().querySelectorAll(`.tag-grid[data-tab="${tab}"] app-tag-toggle button`)] as HTMLButtonElement[];
  const labels = (tab: TagsTab) => buttons(tab).map((b) => b.getAttribute('aria-label'));

  async function selectTab(tab: TagsTab) {
    el().querySelector('ion-segment')!.dispatchEvent(new CustomEvent('ionChange', { detail: { value: tab } }));
    await settle();
  }

  async function search(value: string) {
    el().querySelector('ion-searchbar')!.dispatchEvent(new CustomEvent('ionInput', { detail: { value } }));
    await settle();
  }

  async function openType(type: string, tags: TagResponse[], numPages = 1) {
    await selectTab(type as TagsTab);
    http.expectOne(listUrl(type)).flush({ result: tags, num_pages: numPages, per_page: 100, total: tags.length });
    await settle();
  }

  beforeEach(() => {
    db = new FakeDatabase();
  });

  afterEach(() => http.verify());

  it('shows a Selected tab followed by one tab per tag type', async () => {
    await setUp();
    expect(el().querySelector('ion-title')?.textContent).toContain('Tags');
    const tabs = [...el().querySelectorAll('ion-segment-button')].map((b) => b.textContent?.trim());
    expect(tabs).toEqual(['Selected', 'Tags', 'Artists', 'Characters', 'Parodies', 'Groups', 'Languages', 'Categories']);
    expect(el().querySelector('ion-searchbar')).toBeTruthy();
  });

  it('lists every saved tag on the Selected tab, alphabetically and with its type', async () => {
    db.seed({ id: 2, name: 'yuri', state: 'disabled' });
    db.seed({ id: 1, name: 'ahegao', state: 'enabled' });
    db.rows.set(3, { id: 3, name: 'Someone', slug: 'someone', type: 'artist', count: 5, state: 'enabled', updated_at: 0 });
    await setUp();

    expect(labels('selected')).toEqual(['ahegao (Tag), enabled', 'Someone (Artist), enabled', 'yuri (Tag), disabled']);
  });

  it('filters the Selected tab by name without calling the API', async () => {
    db.seed({ id: 1, name: 'ahegao', state: 'enabled' });
    db.seed({ id: 2, name: 'yuri', state: 'enabled' });
    db.seed({ id: 3, name: 'Yūri on ice', state: 'disabled' });
    await setUp();

    await search('YURI');
    expect(labels('selected')).toEqual(['yuri (Tag), enabled', 'Yūri on ice (Tag), disabled']);

    await search('nothing');
    expect(el().textContent).toContain('No tags match your search.');

    await search('');
    expect(labels('selected').length).toBe(3);
  });

  it('offers to browse tags when nothing is selected', async () => {
    await setUp();
    expect(el().textContent).toContain('No tags selected yet.');

    (el().querySelector('.state ion-button') as HTMLElement).click();
    await settle();
    http.expectOne(listUrl('tag')).flush({ result: [tag(1, 'ahegao')], num_pages: 1, per_page: 100, total: 1 });
    await settle();

    expect(labels('tag')).toEqual(['ahegao, not selected']);
  });

  it('loads each type tab from its own endpoint, once', async () => {
    await setUp();
    await openType('artist', [tag(5, 'someone', 'artist')]);
    expect(labels('artist')).toEqual(['someone, not selected']);

    await openType('language', [tag(6, 'english', 'language')]);
    await selectTab('artist');
    expect(labels('artist')).toEqual(['someone, not selected']); // no new request
  });

  it('searches the open type tab through the API, alphabetically', async () => {
    await setUp();
    await openType('character', [tag(1, 'alice', 'character')]);

    await search('ma');
    const req = http.expectOne(`${API}/tags/search`);
    expect(req.request.body).toEqual({ type: 'character', query: 'ma', limit: 50 });
    req.flush([tag(3, 'Mary', 'character'), tag(2, 'mai', 'character')]);
    await settle();

    expect(labels('character')).toEqual(['mai, not selected', 'Mary, not selected']);
    expect(el().querySelector('ion-infinite-scroll')!.disabled).toBe(true);
  });

  it('applies the current search when switching to another type tab', async () => {
    await setUp();
    await search('eng');
    await selectTab('language');

    const req = http.expectOne(`${API}/tags/search`);
    expect(req.request.body).toEqual({ type: 'language', query: 'eng', limit: 50 });
    req.flush([tag(6, 'english', 'language')]);
    await settle();

    expect(labels('language')).toEqual(['english, not selected']);
  });

  it('ignores results of an outdated search', async () => {
    await setUp();
    await openType('tag', [tag(1, 'ahegao')]);

    await search('a');
    const first = http.expectOne(`${API}/tags/search`);
    await search('ab');
    const second = http.expectOne(`${API}/tags/search`);
    second.flush([tag(2, 'abc')]);
    await settle();
    first.flush([tag(1, 'ahegao')]);
    await settle();

    expect(labels('tag')).toEqual(['abc, not selected']);
  });

  it('saves a tag picked on a type tab with its type, and shows it under Selected', async () => {
    await setUp();
    await openType('parody', [tag(9, 'original', 'parody')]);

    buttons('parody')[0].click();
    await settle();
    expect(labels('parody')[0]).toBe('original, enabled');
    expect(db.rows.get(9)).toMatchObject({ type: 'parody', state: 'enabled' });

    await selectTab('selected');
    expect(labels('selected')).toEqual(['original (Parody), enabled']);
  });

  it('cycles a tag through all three states', async () => {
    await setUp();
    await openType('tag', [tag(1, 'ahegao')]);

    for (const expected of ['enabled', 'disabled', 'not selected']) {
      buttons('tag')[0].click();
      await settle();
      expect(labels('tag')[0]).toBe(`ahegao, ${expected}`);
    }
    expect(db.rows.has(1)).toBe(false);
  });

  it('removes a tag from the Selected tab once it is unselected', async () => {
    db.seed({ id: 1, name: 'ahegao', state: 'enabled' });
    db.seed({ id: 2, name: 'yuri', state: 'enabled' });
    await setUp();

    buttons('selected')[0].click(); // enabled → disabled: stays
    await settle();
    expect(labels('selected')).toEqual(['ahegao (Tag), disabled', 'yuri (Tag), enabled']);

    buttons('selected')[0].click(); // disabled → not selected: removed
    await settle();
    expect(labels('selected')).toEqual(['yuri (Tag), enabled']);
    expect(db.rows.has(1)).toBe(false);
  });

  it('loads the next page of a type when scrolling', async () => {
    await setUp();
    await openType('tag', [tag(1, 'ahegao')], 2);

    const complete = vi.fn().mockResolvedValue(undefined);
    const page = fixture.componentInstance as unknown as { loadMore(event: unknown): Promise<void> };
    const more = page.loadMore({ target: { complete } });
    http
      .expectOne(listUrl('tag', 2))
      .flush({ result: [tag(1, 'ahegao'), tag(2, 'big breasts')], num_pages: 2, per_page: 100, total: 2 });
    await more;
    await settle();

    expect(labels('tag')).toEqual(['ahegao, not selected', 'big breasts, not selected']);
    expect(complete).toHaveBeenCalled();
    expect(el().querySelector('ion-infinite-scroll')!.disabled).toBe(true);
  });

  it('shows an error with retry when a type cannot be loaded', async () => {
    await setUp();
    await selectTab('group');
    http.expectOne(listUrl('group')).flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el().textContent).toContain('Could not load tags.');

    (el().querySelector('.state ion-button') as HTMLElement).click();
    await settle();
    http.expectOne(listUrl('group')).flush({ result: [tag(4, 'circle', 'group')], num_pages: 1, per_page: 100, total: 1 });
    await settle();
    expect(labels('group')).toEqual(['circle, not selected']);
  });

  it('shows a toast and keeps the state when saving fails', async () => {
    await setUp();
    await openType('tag', [tag(1, 'ahegao')]);

    db.failNext = new Error('disk full');
    buttons('tag')[0].click();
    await settle();

    expect(toastCreate).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not save the tag.' }));
    expect(labels('tag')[0]).toBe('ahegao, not selected');
  });

  it('shows an error when the saved tags cannot be read', async () => {
    db.failNext = new Error('locked');
    await setUp();
    expect(el().textContent).toContain('Could not load your saved tags.');
  });

  it('has a back button that always goes to the home page', async () => {
    await setUp();
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
  });
});

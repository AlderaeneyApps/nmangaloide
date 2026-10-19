import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { FavoritesPage } from './favorites.page';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('FavoritesPage', () => {
  let db: FakeDatabase;
  let fixture: ComponentFixture<FavoritesPage>;

  async function render() {
    await TestBed.configureTestingModule({
      imports: [FavoritesPage, getTranslocoTestingModule()],
      providers: [provideRouter([]), provideFakeDatabase(db)],
    }).compileComponents();
    fixture = TestBed.createComponent(FavoritesPage);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    db = new FakeDatabase();
  });

  it('should show the translated title', async () => {
    const el = await render();
    expect(el.querySelector('ion-title')?.textContent).toContain('Favorites');
  });

  it('has a back button that always goes to the home page', async () => {
    await render();
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
  });

  it('shows every favorite as a gallery card, newest first, with its saved cover', async () => {
    db.seedSaved({ id: 1, title_english: 'Older', favorited_at: 100, cover_base64: 'data:image/webp;base64,AAA' });
    db.seedSaved({ id: 2, title_english: 'Newer', favorited_at: 200, cover_base64: 'data:image/webp;base64,BBB' });
    const el = await render();

    const cards = [...el.querySelectorAll('app-gallery-card')];
    expect(cards.map((card) => card.querySelector('.title')?.textContent?.trim())).toEqual(['Newer', 'Older']);
    expect(cards[0].querySelector('img')?.getAttribute('src')).toBe('data:image/webp;base64,BBB');
    // Gallery pages come back here.
    expect(el.querySelector('a.card-link')?.getAttribute('href')).toBe('/gallery/2?from=%2Ffavorites');
  });

  it('leaves out downloads that are not favorites', async () => {
    db.seedSaved({ id: 1 });
    db.seedSaved({ id: 2, is_favorite: 0, favorited_at: null, is_downloaded: 1 });
    const el = await render();
    expect(el.querySelectorAll('app-gallery-card').length).toBe(1);
  });

  it('explains how to add favorites when there are none', async () => {
    const el = await render();
    expect(el.textContent).toContain('No favorites yet.');
    expect(el.textContent).toContain('Tap the heart on a gallery to save it here.');
  });

  it('shows an error with retry when the favorites cannot be read', async () => {
    db.failNext = new Error('locked');
    const el = await render();
    expect(el.textContent).toContain('Could not load your favorites.');

    db.seedSaved({ id: 1 });
    (el.querySelector('.state ion-button') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(el.querySelectorAll('app-gallery-card').length).toBe(1);
  });
});

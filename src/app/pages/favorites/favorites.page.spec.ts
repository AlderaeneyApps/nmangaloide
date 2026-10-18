import { TestBed } from '@angular/core/testing';

import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { FavoritesPage } from './favorites.page';

describe('FavoritesPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FavoritesPage, getTranslocoTestingModule()],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(FavoritesPage);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the translated title', () => {
    const fixture = TestBed.createComponent(FavoritesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-title')?.textContent).toContain('Favorites');
  });
});

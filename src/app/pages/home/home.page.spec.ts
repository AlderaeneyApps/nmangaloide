import { TestBed } from '@angular/core/testing';

import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { HomePage } from './home.page';

describe('HomePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage, getTranslocoTestingModule()],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the title and a menu button', () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-menu-button')).toBeTruthy();
    expect(el.querySelector('ion-title')?.textContent).toContain('Home');
  });
});

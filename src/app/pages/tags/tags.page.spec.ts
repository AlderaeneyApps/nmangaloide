import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { TagsPage } from './tags.page';

describe('TagsPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagsPage, getTranslocoTestingModule()],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(TagsPage);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the translated title', () => {
    const fixture = TestBed.createComponent(TagsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-title')?.textContent).toContain('Tags');
  });
});

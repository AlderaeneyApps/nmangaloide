import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { DownloadedPage } from './downloaded.page';

describe('DownloadedPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadedPage, getTranslocoTestingModule()],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(DownloadedPage);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the translated title', () => {
    const fixture = TestBed.createComponent(DownloadedPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-title')?.textContent).toContain('Downloaded');
  });

  it('has a back button that always goes to the home page', () => {
    const fixture = TestBed.createComponent(DownloadedPage);
    fixture.detectChanges();
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
  });
});

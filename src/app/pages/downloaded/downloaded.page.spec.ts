import { TestBed } from '@angular/core/testing';

import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { DownloadedPage } from './downloaded.page';

describe('DownloadedPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadedPage, getTranslocoTestingModule()],
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
});

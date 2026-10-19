import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { DownloadJob, DownloadService } from '../../services/download.service';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { DownloadingPage } from './downloading.page';

describe('DownloadingPage', () => {
  let jobs: ReturnType<typeof signal<DownloadJob[]>>;
  let folderReady: ReturnType<typeof signal<boolean>>;
  let downloads: {
    jobs: typeof jobs;
    folderReady: typeof folderReady;
    init: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    chooseFolder: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<DownloadingPage>;

  beforeEach(async () => {
    jobs = signal<DownloadJob[]>([]);
    folderReady = signal(true);
    downloads = {
      jobs,
      folderReady,
      chooseFolder: vi.fn().mockImplementation(async () => folderReady.set(true)),
      init: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [DownloadingPage, getTranslocoTestingModule()],
      providers: [provideRouter([]), { provide: DownloadService, useValue: downloads }],
    }).compileComponents();
    fixture = TestBed.createComponent(DownloadingPage);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('ion-item')] as HTMLElement[];

  it('says when nothing is downloading, and is a top-level page', () => {
    expect(el().querySelector('ion-title')?.textContent).toContain('Downloading');
    expect(el().textContent).toContain('Nothing is downloading.');
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
    expect(downloads.init).toHaveBeenCalled();
  });

  it('lists each download with its name, total pages and pages downloaded so far', () => {
    jobs.set([
      { id: 1, title: 'First gallery', totalPages: 30, downloadedPages: 12, status: 'downloading' },
      { id: 2, title: 'Second gallery', totalPages: 8, downloadedPages: 0, status: 'queued' },
    ]);
    fixture.detectChanges();

    expect(rows().map((row) => row.querySelector('.title')?.textContent?.trim())).toEqual(['First gallery', 'Second gallery']);
    expect(rows()[0].querySelector('.progress')?.textContent).toContain('12 / 30 pages');
    expect(rows()[0].querySelector('.progress')?.textContent).toContain('Downloading');
    expect(rows()[1].querySelector('.progress')?.textContent).toContain('0 / 8 pages');
    expect(rows()[1].querySelector('.progress')?.textContent).toContain('Waiting');
    expect((rows()[0].querySelector('ion-progress-bar') as HTMLIonProgressBarElement).value).toBeCloseTo(0.4);
  });

  it('updates as each page is downloaded', () => {
    jobs.set([{ id: 1, title: 'First gallery', totalPages: 3, downloadedPages: 1, status: 'downloading' }]);
    fixture.detectChanges();
    expect(rows()[0].querySelector('.progress')?.textContent).toContain('1 / 3 pages');

    jobs.set([{ id: 1, title: 'First gallery', totalPages: 3, downloadedPages: 2, status: 'downloading' }]);
    fixture.detectChanges();
    expect(rows()[0].querySelector('.progress')?.textContent).toContain('2 / 3 pages');
  });

  it('links each download to its gallery page', () => {
    jobs.set([{ id: 7, title: 'Seven', totalPages: 3, downloadedPages: 1, status: 'downloading' }]);
    fixture.detectChanges();
    expect(rows()[0].querySelector('a.title')?.getAttribute('href')).toBe('/gallery/7?from=%2Fdownloading');
  });

  it('can retry a failed download and cancel any download', () => {
    jobs.set([{ id: 3, title: 'Broken', totalPages: 5, downloadedPages: 2, status: 'failed' }]);
    fixture.detectChanges();
    expect(rows()[0].querySelector('.progress')?.textContent).toContain('Failed');

    (rows()[0].querySelector('[data-action="retry"]') as HTMLElement).click();
    expect(downloads.retry).toHaveBeenCalledWith(3);
    (rows()[0].querySelector('[data-action="cancel"]') as HTMLElement).click();
    expect(downloads.remove).toHaveBeenCalledWith(3);
  });

  it('asks for a download folder when there is none yet (Android)', () => {
    folderReady.set(false);
    jobs.set([{ id: 1, title: 'Waiting', totalPages: 3, downloadedPages: 0, status: 'queued' }]);
    fixture.detectChanges();
    expect(el().querySelector('[data-state="needs-folder"]')?.textContent).toContain('Choose a download folder to start downloading.');

    (el().querySelector('[data-action="choose-folder"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(downloads.chooseFolder).toHaveBeenCalled();
    expect(el().querySelector('[data-state="needs-folder"]')).toBeNull();
  });
});

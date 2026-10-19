import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { DOWNLOAD_SLEEP } from '../../services/download.service';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { FakeDownloadStorage, TEST_FOLDER, provideFakeDownloads } from '../../testing/fake-download-storage';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { DownloadedPage } from './downloaded.page';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('DownloadedPage', () => {
  let db: FakeDatabase;
  let storage: FakeDownloadStorage;
  /** The gallery's CBZ is in the download folder. */
  const onDisk = (id: number) => storage.seed(TEST_FOLDER.uri, `${id}.cbz`);
  let fixture: ComponentFixture<DownloadedPage>;

  async function render() {
    await TestBed.configureTestingModule({
      imports: [DownloadedPage, getTranslocoTestingModule()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        provideFakeDownloads(storage),
        { provide: DOWNLOAD_SLEEP, useValue: () => new Promise(() => undefined) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DownloadedPage);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    db = new FakeDatabase();
    storage = new FakeDownloadStorage();
  });

  it('should show the translated title and go back home', async () => {
    const el = await render();
    expect(el.querySelector('ion-title')?.textContent).toContain('Downloaded');
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
  });

  it('shows finished downloads as gallery cards with their saved covers, newest first', async () => {
    db.seedSaved({ id: 1, title_english: 'Older', is_favorite: 0, is_downloaded: 1, downloaded_at: 10, cover_base64: 'data:a' });
    db.seedSaved({ id: 2, title_english: 'Newer', is_favorite: 0, is_downloaded: 1, downloaded_at: 20, cover_base64: 'data:b' });
    onDisk(1);
    onDisk(2);
    const el = await render();

    const cards = [...el.querySelectorAll('app-gallery-card')];
    expect(cards.map((c) => c.querySelector('.title')?.textContent?.trim())).toEqual(['Newer', 'Older']);
    expect(cards[0].querySelector('img')?.getAttribute('src')).toBe('data:b');
    expect(el.querySelector('a.card-link')?.getAttribute('href')).toBe('/gallery/2?from=%2Fdownloaded');
  });

  it('lists downloads independently from favorites', async () => {
    db.seedSaved({ id: 1, is_favorite: 1 }); // favorite, not downloaded
    db.seedSaved({ id: 2, is_favorite: 0, is_downloaded: 1, downloaded_at: 1 }); // downloaded, not favorite
    onDisk(2);
    const el = await render();
    expect([...el.querySelectorAll('app-gallery-card')].map((c) => c.querySelector('.title')?.textContent?.trim())).toEqual([
      'Gallery 2',
    ]);
  });

  it('no longer lists a download whose CBZ was deleted', async () => {
    db.seedSaved({ id: 5, is_favorite: 0, is_downloaded: 1, downloaded_at: 1 });
    const el = await render();
    expect(el.querySelectorAll('app-gallery-card')).toHaveLength(0);
    expect(db.saved.has(5)).toBe(false);
  });

  it('links to the downloads in progress', async () => {
    db.seedSaved({ id: 3, is_favorite: 0, download_status: 'queued', details_json: JSON.stringify({ id: 3, pages: [] }) });
    const el = await render();
    const link = el.querySelector('[data-action="in-progress"]') as HTMLElement;
    expect(link.textContent).toContain('Downloading (1)');
  });

  it('explains how to download when there are none', async () => {
    const el = await render();
    expect(el.textContent).toContain('No downloads yet.');
    expect(el.querySelector('[data-action="in-progress"]')).toBeNull();
  });
});

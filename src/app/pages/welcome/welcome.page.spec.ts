import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MenuController, NavController, Platform, ToastController } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';

import { BackupService } from '../../services/backup.service';
import { DOWNLOAD_SLEEP } from '../../services/download.service';
import { SetupService } from '../../services/setup.service';
import { NewerBackupError } from '../../sql-services/database.service';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { FakeDownloadStorage, FakePreferences, provideFakeDownloads } from '../../testing/fake-download-storage';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { WelcomePage } from './welcome.page';

describe('WelcomePage', () => {
  let db: FakeDatabase;
  let storage: FakeDownloadStorage;
  let preferences: FakePreferences;
  let fixture: ComponentFixture<WelcomePage>;
  let navigateRoot: ReturnType<typeof vi.fn>;
  let menuEnable: ReturnType<typeof vi.fn>;
  let toastCreate: ReturnType<typeof vi.fn>;
  let importFromFile: ReturnType<typeof vi.fn>;
  let backHandler: ((next: () => void) => void) | null;

  async function render(kind: 'picked' | 'files-app' = 'picked') {
    db = new FakeDatabase();
    storage = new FakeDownloadStorage(kind);
    preferences = new FakePreferences();
    navigateRoot = vi.fn().mockResolvedValue(true);
    menuEnable = vi.fn().mockResolvedValue(undefined);
    toastCreate = vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) });
    importFromFile = vi.fn().mockResolvedValue(undefined);
    backHandler = null;
    await TestBed.configureTestingModule({
      imports: [WelcomePage, getTranslocoTestingModule()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeDatabase(db),
        provideFakeDownloads(storage, preferences, false),
        { provide: DOWNLOAD_SLEEP, useValue: async () => undefined },
        { provide: NavController, useValue: { navigateRoot } },
        { provide: MenuController, useValue: { enable: menuEnable } },
        { provide: ToastController, useValue: { create: toastCreate } },
        { provide: BackupService, useValue: { importFromFile } },
        {
          provide: Platform,
          useValue: {
            backButton: {
              subscribeWithPriority: (_priority: number, handler: (next: () => void) => void) => {
                backHandler = handler;
                return { unsubscribe: vi.fn() };
              },
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WelcomePage);
    fixture.detectChanges();
    await settle();
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const step = () => el().querySelector('.wrapper')?.getAttribute('data-step');
  const fab = (action: string) => el().querySelector(`ion-fab-button[data-action="${action}"]`) as HTMLElement | null;
  async function press(action: string) {
    fab(action)!.click();
    await settle();
  }

  afterEach(() => localStorage.clear());

  it('starts with the language and reader mode, with only a forward button', async () => {
    await render();
    expect(step()).toBe('preferences');
    expect(el().querySelector('h1')?.textContent).toContain('Welcome to nMangaloide');
    expect(el().querySelector('.step-count')?.textContent).toContain('Step 1 of 3');
    const languages = [...el().querySelectorAll('[data-setting="language"] ion-radio')].map((r) => r.textContent?.trim());
    expect(languages).toEqual(['English', 'Español', 'Català', 'Français', 'Deutsch', '日本語', '简体中文', '繁體中文']);
    expect(el().querySelector('[data-setting="language"] ion-radio-group')?.classList).toContain('language-scroll');
    const modes = [...el().querySelectorAll('[data-setting="reader"] ion-radio')].map((r) => r.getAttribute('value'));
    expect(modes).toEqual(['scroll', 'paged']);

    expect(fab('back')).toBeNull();
    expect(fab('next')?.closest('ion-fab')?.getAttribute('horizontal')).toBe('end');
    expect(fab('next')?.querySelector('ion-icon')?.getAttribute('name')).toBe('arrow-forward');
  });

  it('saves the language and reader mode as they are picked', async () => {
    await render();
    el().querySelector('[data-setting="language"] ion-radio-group')!.dispatchEvent(
      new CustomEvent('ionChange', { detail: { value: 'es' } }),
    );
    el().querySelector('[data-setting="reader"] ion-radio-group')!.dispatchEvent(
      new CustomEvent('ionChange', { detail: { value: 'paged' } }),
    );
    await settle();
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('es');
    expect(localStorage.getItem('CapacitorStorage.lang')).toBe('es');
    expect(db.settings.get('reader_mode')).toBe('paged');
    expect(el().querySelector('h1')?.textContent).toContain('Te damos la bienvenida');
  });

  it('asks for the download folder on Android, then offers an optional import, then opens the app', async () => {
    await render();
    await press('next');
    expect(step()).toBe('folder');
    expect(fab('back')?.closest('ion-fab')?.getAttribute('horizontal')).toBe('start');
    expect(fab('back')?.querySelector('ion-icon')?.getAttribute('name')).toBe('arrow-back');

    (el().querySelector('[data-action="choose-folder"]') as HTMLElement).click();
    await vi.waitFor(() => expect(el().querySelector('.chosen')?.textContent).toContain('Saving to: Comics'));
    expect(JSON.parse(preferences.values.get('download_folder')!).name).toBe('Comics');

    await press('next');
    expect(step()).toBe('import');
    expect(el().querySelector('.step-count')?.textContent).toContain('Step 3 of 3');
    expect(fab('next')).toBeNull();
    expect(fab('finish')?.querySelector('ion-icon')?.getAttribute('name')).toBe('arrow-forward');

    await press('finish');
    expect(preferences.values.get('setup_done')).toBe('1');
    expect(await TestBed.inject(SetupService).isDone()).toBe(true);
    expect(navigateRoot).toHaveBeenCalledWith('/');
  });

  it('lets the folder be skipped, and ignores a closed picker', async () => {
    await render();
    await press('next');
    storage.pickResult = Object.assign(new Error('Folder picker cancelled'), { code: 'CANCELLED' });
    (el().querySelector('[data-action="choose-folder"]') as HTMLElement).click();
    await settle();
    expect(toastCreate).not.toHaveBeenCalled();
    expect(el().textContent).toContain('You can skip this and choose it later in Settings.');
    await press('next');
    expect(step()).toBe('import');
  });

  it('skips the folder step on iOS, where downloads go to the app folder in Files', async () => {
    await render('files-app');
    expect(el().querySelector('.step-count')?.textContent).toContain('Step 1 of 2');
    await press('next');
    expect(step()).toBe('import');
    await press('back');
    expect(step()).toBe('preferences');
  });

  it('imports a backup when asked', async () => {
    await render('files-app');
    await press('next');
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    (el().querySelector('[data-action="import"]') as HTMLElement).click();
    expect(click).toHaveBeenCalled();

    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(el().querySelector('.chosen')?.textContent).toContain('Backup imported.'));
    expect(importFromFile).toHaveBeenCalledWith(file);
  });

  it('explains a failed import', async () => {
    await render('files-app');
    importFromFile.mockRejectedValue(new NewerBackupError(99));
    await press('next');
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['{}'], 'b.json')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(toastCreate).toHaveBeenCalledWith(expect.objectContaining({ color: 'danger', message: expect.stringContaining('newer version') })),
    );
    expect(el().querySelector('.chosen')).toBeNull();
  });

  it("hides the side menu, and Android's back button goes to the previous step", async () => {
    await render();
    fixture.componentInstance.ionViewWillEnter();
    expect(menuEnable).toHaveBeenCalledWith(false);
    fixture.componentInstance.ionViewDidEnter(); // no layout in tests: must not throw

    await press('next');
    const next = vi.fn();
    backHandler!(next);
    await settle();
    expect(step()).toBe('preferences');
    expect(next).not.toHaveBeenCalled();
    // On the first step it does what it does elsewhere (closes the app).
    backHandler!(next);
    expect(next).toHaveBeenCalled();

    fixture.componentInstance.ionViewWillLeave();
    expect(menuEnable).toHaveBeenLastCalledWith(true);
  });
});

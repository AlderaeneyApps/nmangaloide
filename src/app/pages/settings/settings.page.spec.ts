import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';

import { BackupService } from '../../services/backup.service';
import { LanguageService } from '../../services/language.service';
import { NewerBackupError } from '../../sql-services/database.service';
import { FakeDatabase, provideFakeDatabase } from '../../testing/fake-database';
import { DOWNLOAD_STORAGE } from '../../native/download-folder';
import { FakeDownloadStorage, provideFakeDownloads } from '../../testing/fake-download-storage';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  let backup: { exportToFile: ReturnType<typeof vi.fn>; importFromFile: ReturnType<typeof vi.fn> };
  let toastCreate: ReturnType<typeof vi.fn>;
  let alertRole: string;
  let alertCreate: ReturnType<typeof vi.fn>;
  let db: FakeDatabase;
  let sheetChoice: { role?: string; data?: string };
  let actionSheetCreate: ReturnType<typeof vi.fn>;

  let storage: FakeDownloadStorage;

  beforeEach(async () => {
    db = new FakeDatabase();
    storage = new FakeDownloadStorage();
    sheetChoice = { data: 'device' };
    actionSheetCreate = vi.fn().mockImplementation(async () => ({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockImplementation(async () => sheetChoice),
    }));
    backup = {
      exportToFile: vi.fn().mockResolvedValue('nmangaloide-backup.json'),
      importFromFile: vi.fn().mockResolvedValue(undefined),
    };
    toastCreate = vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) });
    alertRole = 'confirm';
    alertCreate = vi.fn().mockImplementation(async () => ({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockImplementation(async () => ({ role: alertRole })),
    }));
    await TestBed.configureTestingModule({
      imports: [SettingsPage, getTranslocoTestingModule()],
      providers: [
        provideRouter([]),
        { provide: BackupService, useValue: backup },
        { provide: ToastController, useValue: { create: toastCreate } },
        { provide: AlertController, useValue: { create: alertCreate } },
        { provide: ActionSheetController, useValue: { create: actionSheetCreate } },
        provideFakeDatabase(db),
        provideFakeDownloads(storage),
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('should show the title and the language selector', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-title')?.textContent).toContain('Settings');
    expect((el.querySelector('[data-setting="language"] ion-select') as HTMLIonSelectElement).label).toBe('Language');
    const options = [...el.querySelectorAll('[data-setting="language"] ion-select-option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['English', 'Español', 'Català', 'Français', 'Deutsch', '日本語', '简体中文', '繁體中文']);
  });

  it('should switch and save the language when a new one is picked', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-setting="language"] ion-select') as HTMLElement;
    select.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'fr' } }));

    await vi.waitFor(() => expect(localStorage.getItem('CapacitorStorage.lang')).toBe('fr'));
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('fr');
    expect(TestBed.inject(LanguageService).current()).toBe('fr');
  });

  describe('download folder', () => {
    async function render() {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the chosen folder on Android, and picks another one', async () => {
      const el = await render();
      const item = el.querySelector('[data-section="downloads"] [data-action="download-folder"]') as HTMLElement;
      expect(item.querySelector('.folder-name')?.textContent).toBe('Comics');

      storage.pickResult = { uri: 'content://other', name: 'Other folder' };
      item.click();
      await vi.waitFor(() =>
        expect(toastCreate).toHaveBeenCalledWith(expect.objectContaining({ message: 'Download folder changed.', color: 'success' })),
      );
      expect(el.querySelector('.folder-name')?.textContent).toBe('Other folder');
    });

    it('stays quiet when the picker is closed', async () => {
      const el = await render();
      storage.pickResult = Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      (el.querySelector('[data-action="download-folder"]') as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(toastCreate).not.toHaveBeenCalled();
    });

    it("says where downloads go on iOS, with nothing to choose", async () => {
      TestBed.overrideProvider(DOWNLOAD_STORAGE, { useValue: new FakeDownloadStorage('files-app') });
      const el = await render();
      expect(el.querySelector('[data-action="download-folder"]')).toBeNull();
      expect(el.querySelector('[data-state="app-folder"]')?.textContent).toContain("app's folder in the Files app");
    });
  });

  describe('backups', () => {
    async function render() {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      return fixture;
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve));
    const item = (el: HTMLElement, action: string) => el.querySelector(`[data-action="${action}"]`) as HTMLElement;
    const toastMessages = () => toastCreate.mock.calls.map(([options]) => options.message);

    function chooseFile(el: HTMLElement, file: File) {
      const input = el.querySelector('input[type="file"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    }

    it('shows the export and import buttons', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      expect(item(el, 'export').textContent).toContain('Export database');
      expect(item(el, 'import').textContent).toContain('Import database');
      expect((el.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe('application/json,.json');
    });

    it('exports the database', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      item(el, 'export').click();
      await settle();
      expect(backup.exportToFile).toHaveBeenCalled();
      expect(toastMessages()).toEqual(['Database exported.']);
    });

    it('stays quiet when the share sheet is dismissed', async () => {
      backup.exportToFile.mockRejectedValue(new Error('Share canceled'));
      const el: HTMLElement = (await render()).nativeElement;
      item(el, 'export').click();
      await settle();
      expect(toastMessages()).toEqual([]);
    });

    it('reports export failures', async () => {
      backup.exportToFile.mockRejectedValue(new Error('disk full'));
      const el: HTMLElement = (await render()).nativeElement;
      item(el, 'export').click();
      await settle();
      expect(toastMessages()).toEqual(['Could not export the database.']);
    });

    it('asks before importing, then opens the file picker', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      const input = el.querySelector('input[type="file"]') as HTMLInputElement;
      const pick = vi.spyOn(input, 'click').mockImplementation(() => undefined);

      alertRole = 'cancel';
      item(el, 'import').click();
      await settle();
      expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({ header: 'Replace your data?' }));
      expect(pick).not.toHaveBeenCalled();

      alertRole = 'confirm';
      item(el, 'import').click();
      await settle();
      expect(pick).toHaveBeenCalled();
    });

    it('imports the chosen file', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      const file = new File(['{}'], 'backup.json', { type: 'application/json' });
      chooseFile(el, file);
      await settle();
      expect(backup.importFromFile).toHaveBeenCalledWith(file);
      expect(toastMessages()).toEqual(['Database imported.']);
    });

    it('explains why an import failed', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      backup.importFromFile.mockRejectedValueOnce(new Error('bad'));
      chooseFile(el, new File(['x'], 'x.json'));
      await settle();
      backup.importFromFile.mockRejectedValueOnce(new NewerBackupError(5));
      chooseFile(el, new File(['x'], 'x.json'));
      await settle();
      expect(toastMessages()).toEqual([
        'That file is not a valid nMangaloide backup.',
        'This backup comes from a newer version of the app. Update the app to import it.',
      ]);
    });
  });

  describe('reader mode', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    async function render() {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      return fixture;
    }

    const group = (el: HTMLElement) => el.querySelector('[data-section="reader"] ion-radio-group') as HTMLIonRadioGroupElement;

    it('sits above the backup buttons and defaults to infinite scroll', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      const sections = [...el.querySelectorAll('ion-list-header')].map((h) => h.textContent?.trim());
      expect(sections).toEqual(['Reader', 'Downloads', 'Data']);
      const options = [...el.querySelectorAll('[data-section="reader"] ion-radio')].map((r) => r.textContent);
      expect(options[0]).toContain('Infinite scroll');
      expect(options[1]).toContain('One page at a time');
      expect(group(el).value).toBe('scroll');
    });

    it('shows the saved mode', async () => {
      db.settings.set('reader_mode', 'paged');
      const el: HTMLElement = (await render()).nativeElement;
      expect(group(el).value).toBe('paged');
    });

    it('saves the chosen mode in the database', async () => {
      const fixture = await render();
      group(fixture.nativeElement).dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'paged' } }));
      await settle();
      fixture.detectChanges();
      expect(db.settings.get('reader_mode')).toBe('paged');
      expect(group(fixture.nativeElement).value).toBe('paged');
    });

    it('reports a failed save', async () => {
      const fixture = await render();
      db.failNext = new Error('disk full');
      group(fixture.nativeElement).dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'paged' } }));
      await settle();
      expect(toastCreate).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not save the setting.' }));
      expect(db.settings.has('reader_mode')).toBe(false);
    });
  });

  describe('theme', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    async function render() {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      return fixture;
    }

    const select = (el: HTMLElement) => el.querySelector('[data-setting="theme"] ion-select') as HTMLIonSelectElement;

    it('offers System, Light, Dark and OLED black, under the language', async () => {
      const el: HTMLElement = (await render()).nativeElement;
      const rows = [...el.querySelectorAll('ion-list:first-of-type > ion-item')].map((item) => item.getAttribute('data-setting'));
      expect(rows).toEqual(['language', 'theme']);
      expect(select(el).label).toBe('Theme');
      const options = [...el.querySelectorAll('[data-setting="theme"] ion-select-option')].map((o) => o.textContent?.trim());
      expect(options).toEqual(['System', 'Light', 'Dark', 'OLED black']);
      expect(select(el).value).toBe('system');
    });

    it('saves the chosen theme', async () => {
      const fixture = await render();
      select(fixture.nativeElement).dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'oled' } }));
      await settle();
      fixture.detectChanges();
      expect(db.settings.get('theme')).toBe('oled');
      expect(select(fixture.nativeElement).value).toBe('oled');
    });

    it('reports a failed save', async () => {
      const fixture = await render();
      db.failNext = new Error('disk full');
      select(fixture.nativeElement).dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'dark' } }));
      await settle();
      expect(toastCreate).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not save the setting.' }));
      expect(db.settings.has('theme')).toBe(false);
    });
  });

  it('has a back button that always goes to the home page', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const back = fixture.debugElement.query(By.directive(BackButtonComponent)).componentInstance as BackButtonComponent;
    expect(back.target()).toBe('home');
  });

  describe('export on a phone', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    async function exportOnPhone() {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      await (fixture.componentInstance as unknown as { exportDatabase(native: boolean): Promise<void> }).exportDatabase(true);
      await settle();
      return fixture;
    }
    const toastMessages = () => toastCreate.mock.calls.map(([options]) => options.message);

    it('asks where to put the backup: save to the device or share', async () => {
      await exportOnPhone();
      const options = actionSheetCreate.mock.calls[0][0];
      expect(options.header).toBe('Export database');
      expect(options.buttons.map((b: { text: string }) => b.text)).toEqual(['Save to device…', 'Share…', 'Cancel']);
    });

    it('saves to the device', async () => {
      sheetChoice = { data: 'device' };
      await exportOnPhone();
      expect(backup.exportToFile).toHaveBeenCalledWith('device');
      expect(toastMessages()).toEqual(['Backup saved.']);
    });

    it('shares', async () => {
      sheetChoice = { data: 'share' };
      await exportOnPhone();
      expect(backup.exportToFile).toHaveBeenCalledWith('share');
      expect(toastMessages()).toEqual(['Database exported.']);
    });

    it('does nothing when the choice is cancelled', async () => {
      sheetChoice = { role: 'cancel' };
      await exportOnPhone();
      expect(backup.exportToFile).not.toHaveBeenCalled();
    });

    it('stays quiet when the save picker is closed', async () => {
      backup.exportToFile.mockRejectedValue(Object.assign(new Error('Save cancelled'), { code: 'CANCELLED' }));
      await exportOnPhone();
      expect(toastMessages()).toEqual([]);
    });

    it('skips the question in the browser and downloads', async () => {
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('[data-action="export"]') as HTMLElement).click();
      await settle();
      expect(actionSheetCreate).not.toHaveBeenCalled();
      expect(backup.exportToFile).toHaveBeenCalledWith('device');
    });
  });
});

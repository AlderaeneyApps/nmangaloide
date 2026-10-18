import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';

import { BackupService } from '../../services/backup.service';
import { LanguageService } from '../../services/language.service';
import { NewerBackupError } from '../../sql-services/database.service';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  let backup: { exportToFile: ReturnType<typeof vi.fn>; importFromFile: ReturnType<typeof vi.fn> };
  let toastCreate: ReturnType<typeof vi.fn>;
  let alertRole: string;
  let alertCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('should show the title and the language selector', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-title')?.textContent).toContain('Settings');
    expect((el.querySelector('ion-select') as HTMLIonSelectElement).label).toBe('Language');
    const options = [...el.querySelectorAll('ion-select-option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['English', 'Español', 'Català', 'Français', 'Deutsch']);
  });

  it('should switch and save the language when a new one is picked', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('ion-select') as HTMLElement;
    select.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'fr' } }));

    await vi.waitFor(() => expect(localStorage.getItem('CapacitorStorage.lang')).toBe('fr'));
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('fr');
    expect(TestBed.inject(LanguageService).current()).toBe('fr');
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
        'That file is not a valid nmangaloide backup.',
        'This backup comes from a newer version of the app. Update the app to import it.',
      ]);
    });
  });
});

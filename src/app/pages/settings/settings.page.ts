import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonSpinner,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { cloudDownloadOutline, cloudUploadOutline, folderOpenOutline, folderOutline, shareOutline } from 'ionicons/icons';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { APP_THEMES, AppSettingsService, AppTheme, READER_MODES, ReaderMode } from '../../services/app-settings.service';
import { isCancelled } from '../../native/file-saver';
import { BackupService, ExportDestination } from '../../services/backup.service';
import { DownloadFolderService } from '../../services/download-folder.service';
import { DownloadService } from '../../services/download.service';
import { LanguageService } from '../../services/language.service';
import { NewerBackupError } from '../../sql-services/database.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonIcon,
    IonSpinner,
    IonSelect,
    IonSelectOption,
    IonRadioGroup,
    IonRadio,
    IonNote,
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class SettingsPage implements OnInit {
  protected readonly language = inject(LanguageService);
  protected readonly settings = inject(AppSettingsService);
  protected readonly readerModes = READER_MODES;
  protected readonly themes = APP_THEMES;
  protected readonly folders = inject(DownloadFolderService);
  private readonly downloads = inject(DownloadService);
  private readonly backup = inject(BackupService);
  private readonly alerts = inject(AlertController);
  private readonly actionSheets = inject(ActionSheetController);
  private readonly toasts = inject(ToastController);
  private readonly transloco = inject(TranslocoService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('importFile');

  /** The backup action in progress, if any. */
  protected readonly busy = signal<'export' | 'import' | 'folder' | null>(null);

  constructor() {
    addIcons({ cloudUploadOutline, cloudDownloadOutline, folderOpenOutline, folderOutline, shareOutline });
  }

  ngOnInit(): void {
    this.settings.load().catch(() => this.toast('SETTINGS.SETTINGS_LOAD_ERROR', 'danger'));
    this.folders.load().catch(() => undefined);
  }

  /** Android: picks another folder for downloads; it's scanned for galleries already there. */
  protected async chooseDownloadFolder(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set('folder');
    try {
      await this.downloads.chooseFolder();
      await this.toast('SETTINGS.DOWNLOAD_FOLDER_CHANGED', 'success');
    } catch (error) {
      if (!isCancelled(error)) {
        await this.toast('SETTINGS.DOWNLOAD_FOLDER_ERROR', 'danger');
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async onThemeChange(event: Event): Promise<void> {
    const theme = (event as CustomEvent<{ value: AppTheme }>).detail.value;
    if (theme === this.settings.theme()) {
      return;
    }
    try {
      await this.settings.setTheme(theme);
    } catch {
      await this.toast('SETTINGS.SETTINGS_SAVE_ERROR', 'danger');
    }
  }

  protected async onReaderModeChange(event: Event): Promise<void> {
    const mode = (event as CustomEvent<{ value: ReaderMode }>).detail.value;
    if (mode === this.settings.readerMode()) {
      return;
    }
    try {
      await this.settings.setReaderMode(mode);
    } catch {
      await this.toast('SETTINGS.SETTINGS_SAVE_ERROR', 'danger');
    }
  }

  /**
   * On Android/iOS, asks where the backup goes: saved to a place the user picks
   * on the device, or shared (Drive, iCloud, messages…). The browser downloads it.
   */
  protected async exportDatabase(isNative = Capacitor.isNativePlatform()): Promise<void> {
    if (this.busy()) {
      return;
    }
    let destination: ExportDestination = 'device';
    if (isNative) {
      const choice = await this.chooseExportDestination();
      if (!choice) {
        return;
      }
      destination = choice;
    }
    this.busy.set('export');
    try {
      await this.backup.exportToFile(destination);
      await this.toast(destination === 'device' && isNative ? 'SETTINGS.EXPORT_SAVED' : 'SETTINGS.EXPORT_DONE', 'success');
    } catch (error) {
      // Closing the picker or the share sheet without choosing isn't an error.
      if (!isCancelled(error)) {
        await this.toast('SETTINGS.EXPORT_ERROR', 'danger');
      }
    } finally {
      this.busy.set(null);
    }
  }

  private async chooseExportDestination(): Promise<ExportDestination | null> {
    const sheet = await this.actionSheets.create({
      header: this.transloco.translate('SETTINGS.EXPORT'),
      buttons: [
        { text: this.transloco.translate('SETTINGS.EXPORT_TO_DEVICE'), icon: 'folder-open-outline', data: 'device' },
        { text: this.transloco.translate('SETTINGS.EXPORT_SHARE'), icon: 'share-outline', data: 'share' },
        { text: this.transloco.translate('SETTINGS.CANCEL'), role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data, role } = await sheet.onDidDismiss<ExportDestination>();
    return role === 'cancel' || !data ? null : data;
  }

  /** Asks for confirmation, then opens the file picker. */
  protected async chooseImportFile(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const alert = await this.alerts.create({
      header: this.transloco.translate('SETTINGS.IMPORT_CONFIRM_TITLE'),
      message: this.transloco.translate('SETTINGS.IMPORT_CONFIRM_MESSAGE'),
      buttons: [
        { text: this.transloco.translate('SETTINGS.CANCEL'), role: 'cancel' },
        { text: this.transloco.translate('SETTINGS.IMPORT_CONFIRM'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'confirm') {
      const input = this.fileInput().nativeElement;
      input.value = '';
      input.click();
    }
  }

  protected async onImportFileChosen(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    this.busy.set('import');
    try {
      await this.backup.importFromFile(file);
      await this.toast('SETTINGS.IMPORT_DONE', 'success');
    } catch (error) {
      await this.toast(error instanceof NewerBackupError ? 'SETTINGS.IMPORT_NEWER' : 'SETTINGS.IMPORT_ERROR', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  private async toast(key: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toasts.create({ message: this.transloco.translate(key), duration: 3000, color });
    await toast.present();
  }

  protected async onLanguageChange(event: Event): Promise<void> {
    const lang = (event as CustomEvent<{ value: string }>).detail.value;
    if (lang && lang !== this.language.current()) {
      await this.language.setLanguage(lang);
    }
  }
}

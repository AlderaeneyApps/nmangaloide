import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import {
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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { cloudDownloadOutline, cloudUploadOutline } from 'ionicons/icons';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { AppSettingsService, READER_MODES, ReaderMode } from '../../services/app-settings.service';
import { BackupService } from '../../services/backup.service';
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
  private readonly backup = inject(BackupService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly transloco = inject(TranslocoService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('importFile');

  /** The backup action in progress, if any. */
  protected readonly busy = signal<'export' | 'import' | null>(null);

  constructor() {
    addIcons({ cloudUploadOutline, cloudDownloadOutline });
  }

  ngOnInit(): void {
    this.settings.load().catch(() => this.toast('SETTINGS.SETTINGS_LOAD_ERROR', 'danger'));
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

  protected async exportDatabase(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set('export');
    try {
      await this.backup.exportToFile();
      await this.toast('SETTINGS.EXPORT_DONE', 'success');
    } catch (error) {
      // Closing the share sheet without picking anything isn't an error.
      if (!isShareCancelled(error)) {
        await this.toast('SETTINGS.EXPORT_ERROR', 'danger');
      }
    } finally {
      this.busy.set(null);
    }
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

function isShareCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

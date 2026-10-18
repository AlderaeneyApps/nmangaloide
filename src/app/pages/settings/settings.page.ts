import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
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
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class SettingsPage {
  protected readonly language = inject(LanguageService);
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

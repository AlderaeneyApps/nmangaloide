import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import {
  IonContent,
  IonFab,
  IonFabButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSpinner,
  IonText,
  MenuController,
  NavController,
  Platform,
  ToastController,
} from '@ionic/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { arrowBack, arrowForward, checkmarkCircle, cloudDownloadOutline, folderOpenOutline, languageOutline } from 'ionicons/icons';

import { isCancelled } from '../../native/file-saver';
import { AppSettingsService, READER_MODES, ReaderMode } from '../../services/app-settings.service';
import { BackupService } from '../../services/backup.service';
import { DownloadFolderService } from '../../services/download-folder.service';
import { DownloadService } from '../../services/download.service';
import { HARDWARE_BACK_PRIORITY } from '../../services/hardware-back.service';
import { LanguageService } from '../../services/language.service';
import { SetupService } from '../../services/setup.service';
import { NewerBackupError } from '../../sql-services/database.service';

export type WelcomeStep = 'preferences' | 'folder' | 'import';

/**
 * First-start setup, one step at a time: language and reader mode, the download
 * folder (Android only: iOS uses the app's own folder in Files), and an optional
 * backup import. Back and forward are floating buttons in the bottom corners.
 */
@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  imports: [
    IonContent,
    IonFab,
    IonFabButton,
    IonIcon,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonRadioGroup,
    IonRadio,
    IonSpinner,
    IonText,
    TranslocoPipe,
  ],
})
export class WelcomePage {
  protected readonly language = inject(LanguageService);
  protected readonly settings = inject(AppSettingsService);
  protected readonly folders = inject(DownloadFolderService);
  private readonly downloads = inject(DownloadService);
  private readonly backup = inject(BackupService);
  private readonly setup = inject(SetupService);
  private readonly navController = inject(NavController);
  private readonly menu = inject(MenuController);
  private readonly toasts = inject(ToastController);
  private readonly transloco = inject(TranslocoService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('importFile');
  private readonly languageList = viewChild('languageList', { read: ElementRef });
  /** The language list scrolls on its own (so the reader options stay in view); faded at the bottom until scrolled to the end. */
  protected readonly languageListAtEnd = signal(false);

  protected readonly readerModes = READER_MODES;
  /** The folder step only where the user picks the folder (Android). */
  protected readonly steps: readonly WelcomeStep[] = this.folders.needsPicking
    ? ['preferences', 'folder', 'import']
    : ['preferences', 'import'];
  protected readonly index = signal(0);
  protected readonly step = computed(() => this.steps[this.index()]);
  protected readonly isFirst = computed(() => this.index() === 0);
  protected readonly isLast = computed(() => this.index() === this.steps.length - 1);

  protected readonly busy = signal<'folder' | 'import' | 'finish' | null>(null);
  protected readonly imported = signal(false);

  constructor() {
    addIcons({ arrowBack, arrowForward, checkmarkCircle, cloudDownloadOutline, folderOpenOutline, languageOutline });
    this.settings.load().catch(() => undefined);
    this.folders.load().catch(() => undefined);
    // Android's back button goes to the previous step (and closes the app on the first).
    const subscription = inject(Platform).backButton.subscribeWithPriority(HARDWARE_BACK_PRIORITY + 1, (next) => {
      if (this.isFirst()) {
        next();
      } else {
        this.back();
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /** Once the page is shown (and laid out), scrolls the language list to the current language. */
  ionViewDidEnter(): void {
    const list = this.languageList()?.nativeElement as HTMLElement | undefined;
    const item = list?.querySelector<HTMLElement>(`[data-lang="${this.language.current()}"]`);
    if (list && item) {
      // The chosen language one row below the top, so the row above shows the list scrolls up too.
      const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTop = Math.max(top - item.offsetHeight, 0);
    }
    this.onLanguageListScroll();
  }

  protected onLanguageListScroll(): void {
    const list = this.languageList()?.nativeElement as HTMLElement | undefined;
    this.languageListAtEnd.set(!!list && list.clientHeight > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
  }

  /** The side menu stays hidden during the setup. */
  ionViewWillEnter(): void {
    void this.menu.enable(false);
  }

  ionViewWillLeave(): void {
    void this.menu.enable(true);
  }

  protected back(): void {
    if (!this.busy()) {
      this.index.update((index) => Math.max(index - 1, 0));
    }
  }

  /** The next step, or into the app after the last one. */
  protected async forward(): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!this.isLast()) {
      this.index.update((index) => index + 1);
      return;
    }
    this.busy.set('finish');
    try {
      await this.setup.complete();
      await this.navController.navigateRoot('/');
    } finally {
      this.busy.set(null);
    }
  }

  protected async onLanguageChange(event: Event): Promise<void> {
    const lang = (event as CustomEvent<{ value: string }>).detail.value;
    if (lang && lang !== this.language.current()) {
      await this.language.setLanguage(lang);
    }
  }

  protected async onReaderModeChange(event: Event): Promise<void> {
    const mode = (event as CustomEvent<{ value: ReaderMode }>).detail.value;
    if (mode && mode !== this.settings.readerMode()) {
      await this.settings.setReaderMode(mode).catch(() => this.toast('SETTINGS.SETTINGS_SAVE_ERROR', 'danger'));
    }
  }

  protected async chooseFolder(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set('folder');
    try {
      await this.downloads.chooseFolder();
    } catch (error) {
      if (!isCancelled(error)) {
        await this.toast('WELCOME.FOLDER_ERROR', 'danger');
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected chooseImportFile(): void {
    if (this.busy()) {
      return;
    }
    const input = this.fileInput().nativeElement;
    input.value = '';
    input.click();
  }

  protected async onImportFileChosen(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    this.busy.set('import');
    try {
      await this.backup.importFromFile(file);
      this.imported.set(true);
      await this.toast('WELCOME.IMPORT_DONE', 'success');
    } catch (error) {
      await this.toast(error instanceof NewerBackupError ? 'SETTINGS.IMPORT_NEWER' : 'SETTINGS.IMPORT_ERROR', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  private async toast(key: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toasts.create({ message: this.transloco.translate(key), duration: 3000, color, position: 'top' });
    await toast.present();
  }
}

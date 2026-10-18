import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonMenuButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { cloudDownloadOutline, downloadOutline } from 'ionicons/icons';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';
import { BACK_PARAM } from '../../navigation';
import { DownloadService } from '../../services/download.service';
import { toGalleryListItem } from '../../services/saved-galleries.service';

/** Galleries downloaded to the device, readable offline. Independent from favorites. */
@Component({
  selector: 'app-downloaded',
  templateUrl: './downloaded.page.html',
  styleUrls: ['./downloaded.page.scss'],
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
    TranslocoPipe,
    BackButtonComponent,
    GalleryCardComponent,
  ],
})
export class DownloadedPage implements OnInit {
  protected readonly downloads = inject(DownloadService);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly items = computed(() =>
    this.downloads.downloaded().map((gallery) => ({ gallery: toGalleryListItem(gallery), cover: gallery.cover_base64 })),
  );
  protected readonly inProgress = computed(() => this.downloads.jobs().length);
  /** Gallery pages come back here. */
  protected readonly backParams = { [BACK_PARAM]: '/downloaded' };

  constructor() {
    addIcons({ cloudDownloadOutline, downloadOutline });
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      await this.downloads.init();
      await this.downloads.loadDownloaded();
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

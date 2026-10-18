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
import { heartOutline } from 'ionicons/icons';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';
import { BACK_PARAM } from '../../navigation';
import { SavedGalleriesService, toGalleryListItem } from '../../services/saved-galleries.service';

/** The galleries saved as favorites, read from the device (no API calls). */
@Component({
  selector: 'app-favorites',
  templateUrl: './favorites.page.html',
  styleUrls: ['./favorites.page.scss'],
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
export class FavoritesPage implements OnInit {
  private readonly saved = inject(SavedGalleriesService);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly items = computed(() =>
    this.saved.favorites().map((gallery) => ({ gallery: toGalleryListItem(gallery), cover: gallery.cover_base64 })),
  );
  /** Gallery pages come back here. */
  protected readonly backParams = { [BACK_PARAM]: '/favorites' };

  constructor() {
    addIcons({ heartOutline });
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      await this.saved.load();
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

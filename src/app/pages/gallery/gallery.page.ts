import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonLabel,
  IonMenuButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { bookOutline, documentsOutline, heartOutline, timeOutline } from 'ionicons/icons';

import { CdnService, GalleryDetailResponse, TAG_TYPES, TagResponse, TagType } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { BACK_PARAM, SEARCH_PARAM } from '../../navigation';
import { GalleryDetailsService } from '../../services/gallery-details.service';
import { buildGallerySearchQuery } from '../../services/tag-preferences.service';

export interface TagGroup {
  type: TagType;
  tags: TagResponse[];
}

/** Order of the tag groups: who made it and what it's from first, then the rest. */
const GROUP_ORDER: readonly TagType[] = ['artist', 'group', 'parody', 'character', 'tag', 'language', 'category'];

/** A gallery's details: cover, titles, artists, groups, parodies, tags… and a button to read it. */
@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.page.html',
  styleUrls: ['./gallery.page.scss'],
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonButton,
    IonFab,
    IonFabButton,
    IonChip,
    IonIcon,
    IonLabel,
    IonSpinner,
    IonText,
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class GalleryPage {
  private readonly details = inject(GalleryDetailsService);
  private readonly cdn = inject(CdnService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly navController = inject(NavController);

  /** The gallery id, from the `gallery/:id` route. */
  readonly id = input.required<string>();

  protected readonly gallery = signal<GalleryDetailResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly coverUrl = computed(() => this.cdn.thumbnailUrl(this.gallery()?.cover.path));
  protected readonly coverRatio = computed(() => {
    const cover = this.gallery()?.cover;
    return cover && cover.width > 0 && cover.height > 0 ? `${cover.width} / ${cover.height}` : '2 / 3';
  });

  /** The gallery's tags, grouped by type in GROUP_ORDER and sorted by name. */
  protected readonly tagGroups = computed<TagGroup[]>(() => {
    const tags = this.gallery()?.tags ?? [];
    const order = [...GROUP_ORDER, ...TAG_TYPES.filter((type) => !GROUP_ORDER.includes(type))];
    return order
      .map((type) => ({
        type,
        tags: tags
          .filter((tag) => tag.type === type)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      }))
      .filter((group) => group.tags.length > 0);
  });

  protected readonly uploadDate = computed(() => {
    const seconds = this.gallery()?.upload_date;
    if (!seconds) {
      return '';
    }
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), { dateStyle: 'medium' }).format(
      new Date(seconds * 1000),
    );
  });

  /** The reader link comes back here. */
  protected readonly readerParams = computed(() => ({ [BACK_PARAM]: this.router.url }));

  constructor() {
    addIcons({ bookOutline, documentsOutline, heartOutline, timeOutline });
    effect(() => {
      void this.load(Number(this.id()));
    });
  }

  /** Goes back to the home page, searching for galleries with this one tag, artist, group… */
  protected searchFor(tag: TagResponse): void {
    const query = buildGallerySearchQuery([{ type: tag.type, name: tag.name, state: 'enabled' }]);
    void this.navController.navigateRoot(['/'], { queryParams: { [SEARCH_PARAM]: query } });
  }

  async load(id: number = Number(this.id())): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const [gallery] = await Promise.all([this.details.get(id), this.cdn.load().catch(() => undefined)]);
      this.gallery.set(gallery);
    } catch {
      this.gallery.set(null);
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

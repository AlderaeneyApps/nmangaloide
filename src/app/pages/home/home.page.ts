import { Component, OnInit, inject, signal } from '@angular/core';
import {
  InfiniteScrollCustomEvent,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonMenuButton,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  RefresherCustomEvent,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CdnService, GalleriesService, GalleryListItem } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';

const PER_PAGE = 25;

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonSpinner,
    IonText,
    IonButton,
    TranslocoPipe,
    BackButtonComponent,
    GalleryCardComponent,
  ],
})
export class HomePage implements OnInit {
  private readonly galleriesService = inject(GalleriesService);
  private readonly cdn = inject(CdnService);

  protected readonly galleries = signal<GalleryListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly hasMore = signal(false);

  private page = 0;

  ngOnInit(): void {
    void this.loadFirstPage();
  }

  /** Loads (or reloads) the newest galleries from the first page. */
  async loadFirstPage(): Promise<void> {
    this.page = 0;
    this.error.set(false);
    this.loading.set(true);
    try {
      // The CDN servers are needed to build thumbnail URLs; a failure there
      // shouldn't hide the list, so it's loaded alongside and ignored on error.
      const [response] = await Promise.all([this.fetchPage(1), this.cdn.load().catch(() => undefined)]);
      this.galleries.set(response.result);
    } catch {
      this.galleries.set([]);
      this.hasMore.set(false);
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMore(event: InfiniteScrollCustomEvent): Promise<void> {
    try {
      const response = await this.fetchPage(this.page + 1);
      this.galleries.update((current) => [...current, ...response.result]);
    } catch {
      // Keep what's already shown; scrolling again retries the same page.
    } finally {
      await event.target.complete();
    }
  }

  protected async refresh(event: RefresherCustomEvent): Promise<void> {
    await this.loadFirstPage();
    await event.target.complete();
  }

  private async fetchPage(page: number) {
    const response = await firstValueFrom(this.galleriesService.list(page, PER_PAGE));
    this.page = page;
    this.hasMore.set(page < response.num_pages && response.result.length > 0);
    return response;
  }
}

import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  InfiniteScrollCustomEvent,
  IonButton,
  IonChip,
  IonIcon,
  IonLabel,
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
  NavController,
  RefresherCustomEvent,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { closeCircle, pricetagsOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import { CdnService, GalleriesService, GalleryListItem, PaginatedGalleryListItemResponse, SearchService } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';
import { BACK_PARAM, SEARCH_PARAM, parseSingleFilter } from '../../navigation';
import { TagPreferencesService } from '../../services/tag-preferences.service';

const PER_PAGE = 25;

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    RouterLink,
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
    IonChip,
    IonIcon,
    IonLabel,
    TranslocoPipe,
    BackButtonComponent,
    GalleryCardComponent,
  ],
})
export class HomePage {
  private readonly galleriesService = inject(GalleriesService);
  private readonly searchService = inject(SearchService);
  private readonly cdn = inject(CdnService);
  private readonly router = inject(Router);
  private readonly navController = inject(NavController);
  private readonly tagPreferences = inject(TagPreferencesService);

  /** Optional gallery search from the `q` query parameter, e.g. `artist:"someone"`. */
  readonly q = input<string | undefined>(undefined);

  protected readonly query = computed(() => this.q()?.trim() ?? '');
  /** The search as a type + name, when it's a single filter (shown as a chip). */
  protected readonly filter = computed(() => parseSingleFilter(this.query()));

  /** True while the list is filtered by the tags saved on the Tags page (no `q` search). */
  protected readonly usingSavedTags = signal(false);
  protected readonly savedTagCount = computed(() => this.tagPreferences.preferences().length);
  /** Any filter is applied: a `q` search or the saved tags. */
  protected readonly filtered = computed(() => !!this.query() || this.usingSavedTags());

  protected readonly galleries = signal<GalleryListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly hasMore = signal(false);
  /** Gallery pages come back here, search included. */
  protected readonly backParams = computed(() => {
    const query = this.query();
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/'], { queryParams: query ? { [SEARCH_PARAM]: query } : {} }),
    );
    return { [BACK_PARAM]: url };
  });

  private page = 0;
  /** The search the list was last loaded for ('' = newest galleries); null before the first load. */
  private loadedQuery: string | null = null;
  /** Increases with every new load, so a late response for an older search is dropped. */
  private generation = 0;

  constructor() {
    addIcons({ closeCircle, pricetagsOutline });
    effect(() => {
      this.query();
      untracked(() => void this.loadFirstPage());
    });
  }

  /**
   * Coming back to the page (e.g. from the Tags page): reload if the saved tags
   * changed the search meanwhile. Changes aren't reloaded live, so toggling tags
   * doesn't fire a request per tap.
   */
  ionViewWillEnter(): void {
    if (this.loadedQuery !== null && !this.query() && this.savedTagsQuery() !== this.loadedQuery) {
      void this.loadFirstPage();
    }
  }

  /** Loads (or reloads) the first page: the search results, or the newest galleries. */
  async loadFirstPage(): Promise<void> {
    const generation = ++this.generation;
    this.page = 0;
    this.error.set(false);
    this.loading.set(true);
    this.galleries.set([]);
    // A `q` search (from a gallery's tag) wins; otherwise filter by the saved tags.
    let query = this.query();
    if (!query) {
      await this.tagPreferences.load().catch(() => undefined);
      if (generation !== this.generation) {
        return;
      }
      query = this.savedTagsQuery();
    }
    this.usingSavedTags.set(!this.query() && !!query);
    this.loadedQuery = query;
    try {
      // The CDN servers are needed to build thumbnail URLs; a failure there
      // shouldn't hide the list, so it's loaded alongside and ignored on error.
      const [response] = await Promise.all([this.fetchPage(query, 1), this.cdn.load().catch(() => undefined)]);
      if (generation !== this.generation) {
        return;
      }
      this.apply(response, 1);
      this.galleries.set(response.result);
    } catch {
      if (generation === this.generation) {
        this.galleries.set([]);
        this.hasMore.set(false);
        this.error.set(true);
      }
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
      }
    }
  }

  /** Back to the newest galleries. */
  protected clearSearch(): void {
    void this.navController.navigateRoot(['/']);
  }

  protected async loadMore(event: InfiniteScrollCustomEvent): Promise<void> {
    const generation = this.generation;
    try {
      const page = this.page + 1;
      const response = await this.fetchPage(this.loadedQuery ?? '', page);
      if (generation === this.generation) {
        this.apply(response, page);
        this.galleries.update((current) => [...current, ...response.result]);
      }
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

  private savedTagsQuery(): string {
    return this.tagPreferences.searchQuery();
  }

  private fetchPage(query: string, page: number): Promise<PaginatedGalleryListItemResponse> {
    return firstValueFrom(
      query ? this.searchService.search(query, 'date', page) : this.galleriesService.list(page, PER_PAGE),
    );
  }

  private apply(response: PaginatedGalleryListItemResponse, page: number): void {
    this.page = page;
    this.hasMore.set(page < response.num_pages && response.result.length > 0);
  }
}

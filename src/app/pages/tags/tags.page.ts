import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  InfiniteScrollCustomEvent,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonLabel,
  IonMenuButton,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { TAG_TYPES, TagResponse, TagType, TagsService } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { TagToggleComponent } from '../../components/tag-toggle/tag-toggle.component';
import { TagInfo, TagPreferencesService } from '../../services/tag-preferences.service';

export type TagsTab = 'selected' | TagType;

/** Tags per page when browsing a type. */
const PER_PAGE = 100;
/** The API's maximum for tag search results (it doesn't paginate them). */
const SEARCH_LIMIT = 50;

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The loaded tags of one type tab. */
class TagTypeList {
  readonly tags = signal<TagResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly hasMore = signal(false);
  page = 0;
  /** The search the list was loaded for; null until the tab is first opened. */
  loadedQuery: string | null = null;
  /** Increases with every new load, so late responses from an older search are dropped. */
  generation = 0;
}

@Component({
  selector: 'app-tags',
  templateUrl: './tags.page.html',
  styleUrls: ['./tags.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonSpinner,
    IonText,
    IonButton,
    TranslocoPipe,
    BackButtonComponent,
    TagToggleComponent,
  ],
})
export class TagsPage implements OnInit {
  private readonly tagsService = inject(TagsService);
  private readonly toasts = inject(ToastController);
  private readonly transloco = inject(TranslocoService);
  protected readonly preferences = inject(TagPreferencesService);

  protected readonly types = TAG_TYPES;
  protected readonly tab = signal<TagsTab>('selected');
  protected readonly query = signal('');

  // "Selected" tab: every saved tag, of any type.
  protected readonly selectedLoading = signal(true);
  protected readonly selectedError = signal(false);
  protected readonly filteredSelected = computed(() => {
    const query = this.normalize(this.query());
    const all = this.preferences.preferences();
    return query ? all.filter((tag) => this.normalize(tag.name).includes(query)) : all;
  });

  // One list per tag type, loaded the first time its tab is opened.
  private readonly lists = Object.fromEntries(TAG_TYPES.map((type) => [type, new TagTypeList()])) as Record<
    TagType,
    TagTypeList
  >;
  protected readonly activeList = computed(() => {
    const tab = this.tab();
    return tab === 'selected' ? null : this.lists[tab];
  });

  /** Tags with a save in progress, so a tap can't be counted twice. */
  protected readonly saving = signal<ReadonlySet<number>>(new Set());

  protected readonly infiniteDisabled = computed(() => {
    const list = this.activeList();
    return !list || !!this.query() || !list.hasMore();
  });

  ngOnInit(): void {
    void this.loadSelected();
  }

  protected onTabChange(event: Event): void {
    this.showTab((event as CustomEvent<{ value: TagsTab }>).detail.value);
  }

  protected onSearch(event: Event): void {
    this.query.set(((event as CustomEvent<{ value?: string | null }>).detail.value ?? '').trim());
    this.refreshActiveList();
  }

  protected showTab(tab: TagsTab): void {
    this.tab.set(tab);
    this.refreshActiveList();
  }

  async loadSelected(): Promise<void> {
    this.selectedLoading.set(true);
    this.selectedError.set(false);
    try {
      await this.preferences.load();
    } catch {
      this.selectedError.set(true);
    } finally {
      this.selectedLoading.set(false);
    }
  }

  /** (Re)loads a type tab for the current search: browse alphabetically, or search by name. */
  async loadType(type: TagType): Promise<void> {
    const list = this.lists[type];
    const query = this.query();
    const generation = ++list.generation;
    list.loadedQuery = query;
    list.page = 0;
    list.error.set(false);
    list.loading.set(true);
    list.tags.set([]);
    try {
      let tags: TagResponse[];
      let hasMore = false;
      if (query) {
        const results = await firstValueFrom(this.tagsService.search({ type, query, limit: SEARCH_LIMIT }));
        tags = results.filter((tag) => tag.type === type).sort(byName);
      } else {
        const response = await firstValueFrom(this.tagsService.listByType(type, 'name', 1, PER_PAGE));
        tags = response.result;
        hasMore = 1 < response.num_pages && response.result.length > 0;
        list.page = 1;
      }
      if (generation !== list.generation) {
        return;
      }
      list.tags.set(tags);
      list.hasMore.set(hasMore);
    } catch {
      if (generation === list.generation) {
        list.hasMore.set(false);
        list.error.set(true);
        // Not loaded: reopening the tab (or Retry) tries again.
        list.loadedQuery = null;
      }
    } finally {
      if (generation === list.generation) {
        list.loading.set(false);
      }
    }
  }

  /** Retries loading the open type tab. */
  protected retryActive(): void {
    const tab = this.tab();
    if (tab !== 'selected') {
      void this.loadType(tab);
    }
  }

  protected async loadMore(event: InfiniteScrollCustomEvent): Promise<void> {
    const tab = this.tab();
    try {
      if (tab !== 'selected' && !this.query()) {
        const list = this.lists[tab];
        const generation = list.generation;
        const response = await firstValueFrom(this.tagsService.listByType(tab, 'name', list.page + 1, PER_PAGE));
        if (generation === list.generation) {
          list.page += 1;
          list.hasMore.set(list.page < response.num_pages && response.result.length > 0);
          // Pages can overlap if tags are added meanwhile, so skip ones already shown.
          list.tags.update((current) => {
            const seen = new Set(current.map((tag) => tag.id));
            return [...current, ...response.result.filter((tag) => !seen.has(tag.id))];
          });
        }
      }
    } catch {
      // Keep what's shown; scrolling again retries the same page.
    } finally {
      await event.target.complete();
    }
  }

  /** Moves a tag to its next state: not selected → enabled → disabled → not selected. */
  async toggle(tag: TagInfo): Promise<void> {
    if (this.saving().has(tag.id)) {
      return;
    }
    this.saving.update((ids) => new Set(ids).add(tag.id));
    try {
      await this.preferences.cycle(tag);
    } catch {
      const toast = await this.toasts.create({
        message: this.transloco.translate('TAGS.SAVE_ERROR'),
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    } finally {
      this.saving.update((ids) => {
        const next = new Set(ids);
        next.delete(tag.id);
        return next;
      });
    }
  }

  /** Loads the open type tab if it hasn't been loaded for the current search yet. */
  private refreshActiveList(): void {
    const tab = this.tab();
    if (tab !== 'selected' && this.lists[tab].loadedQuery !== this.query()) {
      void this.loadType(tab);
    }
  }

  private normalize(text: string): string {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  }
}

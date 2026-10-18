import { Component, HostListener, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';

import { CdnService, GalleryDetailResponse } from '../../api';
import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { AppSettingsService } from '../../services/app-settings.service';
import { DownloadService } from '../../services/download.service';
import { GalleryDetailsService } from '../../services/gallery-details.service';

export interface ReaderPageImage {
  number: number;
  url: string | null;
  /** CSS aspect-ratio, so the space is reserved before the image loads. */
  ratio: string;
}

/** How many pages ahead to preload in one-page-at-a-time mode. */
const PRELOAD_AHEAD = 2;
/** Near the top the bar always shows (roughly the toolbar's height). */
const SHOW_HEADER_NEAR_TOP = 56;
/** Ignore scroll jitter smaller than this before hiding or showing the bar. */
const SCROLL_THRESHOLD = 8;

/**
 * Shows a gallery's pages in order, either as one infinite vertical scroll or
 * one page at a time, depending on the reader mode in Settings.
 */
@Component({
  selector: 'app-reader',
  templateUrl: './reader.page.html',
  styleUrls: ['./reader.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    IonFooter,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class ReaderPage {
  private readonly details = inject(GalleryDetailsService);
  private readonly cdn = inject(CdnService);
  private readonly settings = inject(AppSettingsService);
  private readonly downloads = inject(DownloadService);
  /** Pages saved on the device (downloads), by number; shown instead of the CDN images. */
  private readonly offlinePages = signal<ReadonlyMap<number, string>>(new Map());

  /** The gallery id, from the `gallery/:id/read` route. */
  readonly id = input.required<string>();
  /** Optional 1-based page to start on (`?page=5`). */
  readonly page = input<string | undefined>(undefined);

  private readonly content = viewChild(IonContent);

  protected readonly gallery = signal<GalleryDetailResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly mode = this.settings.readerMode;

  protected readonly pages = computed<ReaderPageImage[]>(() =>
    [...(this.gallery()?.pages ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((page) => ({
        number: page.number,
        url: this.offlinePages().get(page.number) ?? this.cdn.imageUrl(page.path),
        ratio: page.width > 0 && page.height > 0 ? `${page.width} / ${page.height}` : '2 / 3',
      })),
  );

  /** In infinite scroll mode the top bar hides while scrolling down and returns on scrolling up. */
  protected readonly headerHidden = signal(false);
  private lastScrollTop = 0;

  /** Index of the page shown in one-page-at-a-time mode. */
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.pages()[this.index()] ?? null);
  protected readonly hasPrevious = computed(() => this.index() > 0);
  protected readonly hasNext = computed(() => this.index() < this.pages().length - 1);

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline });
    effect(() => {
      void this.load(Number(this.id()));
    });
    // Preload the next pages so turning the page is instant.
    effect(() => {
      if (this.mode() !== 'paged') {
        return;
      }
      const pages = this.pages();
      for (let i = this.index() + 1; i <= this.index() + PRELOAD_AHEAD && i < pages.length; i++) {
        const url = pages[i].url;
        if (url) {
          new Image().src = url;
        }
      }
    });
  }

  async load(id: number = Number(this.id())): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const [gallery, offline] = await Promise.all([
        this.details.get(id),
        // Downloaded pages work offline; missing ones come from the CDN.
        this.downloads.getPages(id).catch(() => new Map<number, string>()),
        this.cdn.load().catch(() => undefined),
        // Fall back to the default mode if the setting can't be read.
        this.settings.load().catch(() => undefined),
      ]);
      this.offlinePages.set(offline);
      this.gallery.set(gallery);
      const start = Number(this.page()) - 1;
      this.index.set(Number.isInteger(start) ? Math.min(Math.max(start, 0), Math.max(gallery.pages.length - 1, 0)) : 0);
    } catch {
      this.gallery.set(null);
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected onScroll(event: Event): void {
    if (this.mode() !== 'scroll') {
      return;
    }
    const top = Math.max((event as CustomEvent<{ scrollTop: number }>).detail.scrollTop, 0);
    const delta = top - this.lastScrollTop;
    if (top <= SHOW_HEADER_NEAR_TOP) {
      this.headerHidden.set(false);
      this.lastScrollTop = top;
    } else if (Math.abs(delta) >= SCROLL_THRESHOLD) {
      this.headerHidden.set(delta > 0);
      this.lastScrollTop = top;
    }
  }

  protected next(): void {
    this.goTo(this.index() + 1);
  }

  protected previous(): void {
    this.goTo(this.index() - 1);
  }

  /** Tapping the left third goes back, anywhere else goes forward. */
  protected onPageTap(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const { left, width } = target.getBoundingClientRect();
    if (width > 0 && event.clientX - left < width / 3) {
      this.previous();
    } else {
      this.next();
    }
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (this.mode() !== 'paged' || !this.gallery()) {
      return;
    }
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      this.next();
    } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      this.previous();
    }
  }

  private goTo(index: number): void {
    const clamped = Math.min(Math.max(index, 0), this.pages().length - 1);
    if (clamped === this.index() || clamped < 0) {
      return;
    }
    this.index.set(clamped);
    void this.content()?.scrollToTop();
  }
}

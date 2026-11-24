import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
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
/** Two taps within this time (ms) are a double tap; a single tap in paged mode waits this long. */
const DOUBLE_TAP_MS = 300;
/** ...and within this distance (px) of each other. */
const DOUBLE_TAP_DISTANCE = 40;
/** How much a double tap zooms in. */
const ZOOM_SCALE = 2.5;

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
export class ReaderPage implements OnDestroy {
  private readonly details = inject(GalleryDetailsService);
  private readonly cdn = inject(CdnService);
  private readonly settings = inject(AppSettingsService);
  private readonly downloads = inject(DownloadService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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
  protected readonly direction = this.settings.pageDirection;

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

  /** Zoom level set by double tapping: 1 is the regular fit. */
  protected readonly zoom = signal(1);
  protected readonly zoomed = computed(() => this.zoom() > 1);
  private lastTap: { time: number; x: number; y: number } | null = null;
  private pendingTap: ReturnType<typeof setTimeout> | undefined;

  /**
   * The downloaded gallery whose unpacked pages this page holds. DownloadService counts
   * every getPages() call, so a gallery is asked for once (not on every Retry) and
   * released when another one is opened or the page closes.
   */
  private held: { id: number; pages: Promise<ReadonlyMap<number, string>> } | null = null;
  /** Increases with every load, so a late answer for an earlier one is dropped. */
  private loads = 0;

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
    const load = ++this.loads;
    this.loading.set(true);
    this.error.set(false);
    this.zoom.set(1);
    try {
      const [gallery, offline] = await Promise.all([
        this.details.get(id),
        // A download's pages are unpacked from its CBZ to work offline; missing ones come from the CDN.
        this.holdPages(id),
        this.cdn.load().catch(() => undefined),
        // Fall back to the default mode if the setting can't be read.
        this.settings.load().catch(() => undefined),
      ]);
      if (load !== this.loads) {
        return;
      }
      this.offlinePages.set(offline);
      this.gallery.set(gallery);
      const start = Number(this.page()) - 1;
      this.index.set(Number.isInteger(start) ? Math.min(Math.max(start, 0), Math.max(gallery.pages.length - 1, 0)) : 0);
    } catch {
      if (load !== this.loads) {
        return;
      }
      this.gallery.set(null);
      this.error.set(true);
    } finally {
      if (load === this.loads) {
        this.loading.set(false);
      }
    }
    if (load === this.loads && this.mode() === 'scroll' && this.index() > 0) {
      afterNextRender({ read: () => void this.scrollToPage(this.index()) }, { injector: this.injector });
    }
  }

  /** The unpacked pages of gallery `id` (empty if it isn't downloaded), releasing any other gallery's. */
  private holdPages(id: number): Promise<ReadonlyMap<number, string>> {
    if (this.held?.id === id) {
      return this.held.pages;
    }
    this.releaseHeldPages();
    const held = {
      id,
      pages: this.downloads.getPages(id).catch(() => {
        // Nothing is held after a failure (DownloadService forgets it), so a retry asks again.
        if (this.held === held) {
          this.held = null;
        }
        return new Map<number, string>();
      }),
    };
    this.held = held;
    return held.pages;
  }

  private releaseHeldPages(): void {
    if (this.held) {
      void this.downloads.releasePages(this.held.id);
      this.held = null;
    }
  }

  /** In infinite scroll mode, starts at the given page (its space is reserved before images load). */
  private async scrollToPage(index: number): Promise<void> {
    const content = this.content();
    const page = this.host.nativeElement.querySelector<HTMLElement>(`.scroll .page[data-page="${this.pages()[index]?.number}"]`);
    if (!content || !page) {
      return;
    }
    const scroller = await content.getScrollElement();
    const top = page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    await content.scrollToPoint(0, Math.max(top, 0));
  }

  /** The pages unpacked from a downloaded gallery's CBZ are temporary: removed on leaving. */
  ngOnDestroy(): void {
    clearTimeout(this.pendingTap);
    this.releaseHeldPages();
  }

  /** A downloaded page that can't be shown (e.g. its file was deleted) falls back to the CDN. */
  protected onImageError(number: number): void {
    if (this.offlinePages().has(number)) {
      const pages = new Map(this.offlinePages());
      pages.delete(number);
      this.offlinePages.set(pages);
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

  /**
   * Double tapping zooms in on that spot, or back out. Otherwise, while not zoomed,
   * tapping the back third goes back and anywhere else goes forward. The back third is
   * the left one by default ('rtl'), or the right one when the direction is 'ltr'.
   */
  protected onPageTap(event: MouseEvent): void {
    if (this.isDoubleTap(event)) {
      clearTimeout(this.pendingTap);
      void this.toggleZoom(event);
      return;
    }
    if (this.zoomed()) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const { left, width } = target.getBoundingClientRect();
    const offset = event.clientX - left;
    const back = width > 0 && (this.direction() === 'ltr' ? offset > (width * 2) / 3 : offset < width / 3);
    // Wait to see whether a second tap makes this a double tap.
    clearTimeout(this.pendingTap);
    this.pendingTap = setTimeout(() => (back ? this.previous() : this.next()), DOUBLE_TAP_MS);
  }

  /** In infinite scroll mode a single tap does nothing, so only double taps (zoom) matter. */
  protected onScrollTap(event: MouseEvent): void {
    if (this.isDoubleTap(event)) {
      void this.toggleZoom(event);
    }
  }

  private isDoubleTap(event: MouseEvent): boolean {
    const now = Date.now();
    const last = this.lastTap;
    if (
      last &&
      now - last.time < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_DISTANCE
    ) {
      this.lastTap = null;
      return true;
    }
    this.lastTap = { time: now, x: event.clientX, y: event.clientY };
    return false;
  }

  /** Zooms in or out, keeping the tapped spot under the finger. */
  private async toggleZoom(event: MouseEvent): Promise<void> {
    const content = this.content();
    if (!content) {
      return;
    }
    const scroller = await content.getScrollElement();
    const rect = scroller.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const from = this.zoom();
    const to = from > 1 ? 1 : ZOOM_SCALE;
    const ratio = to / from;
    const left = (scroller.scrollLeft + x) * ratio - x;
    const top = (scroller.scrollTop + y) * ratio - y;
    this.zoom.set(to);
    afterNextRender({ read: () => scroller.scrollTo({ left: Math.max(left, 0), top: Math.max(top, 0) }) }, { injector: this.injector });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (this.mode() !== 'paged' || !this.gallery()) {
      return;
    }
    const [forwardArrow, backArrow] = this.direction() === 'ltr' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    if ([forwardArrow, 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      this.next();
    } else if ([backArrow, 'PageUp'].includes(event.key)) {
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
    this.zoom.set(1);
    void this.content()?.scrollToTop();
  }
}

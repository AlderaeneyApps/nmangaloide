import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonApp, IonIcon, IonLabel, IonRouterLink, IonRouterOutlet, IonTabBar, IonTabButton } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import {
  downloadOutline,
  downloadSharp,
  heartOutline,
  heartSharp,
  homeOutline,
  homeSharp,
  pricetagOutline,
  pricetagSharp,
} from 'ionicons/icons';

import { BOTTOM_BAR_PAGES, injectCurrentUrl, injectOnTopLevelPage } from './app-pages';
import { pathOf, pathSegments } from './navigation';
import { DownloadNotificationService } from './services/download-notification.service';
import { FavoritesSyncService } from './services/favorites-sync.service';
import { DownloadService } from './services/download.service';
import { HardwareBackService } from './services/hardware-back.service';
import { LanguageService } from './services/language.service';
import { ThemeService } from './services/theme.service';

/** Whether `url` shows the bottom bar: every page but the reader and the first-start setup. */
export function showsBottomBar(url: string): boolean {
  const [first, , third] = pathSegments(url);
  return first !== 'welcome' && !(first === 'gallery' && third === 'read');
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    RouterLink,
    IonApp,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    IonRouterLink,
    IonRouterOutlet,
    TranslocoPipe,
  ],
})
export class AppComponent {
  private readonly url = injectCurrentUrl();

  /**
   * Bottom bar pages open on top of the home page so iOS's swipe back has somewhere
   * to go. Moving between top-level pages replaces the current one, so it's always home.
   */
  protected readonly onTopLevelPage = injectOnTopLevelPage();

  protected readonly showBottomBar = computed(() => showsBottomBar(this.url()));

  /** The bottom bar tab of the current page, if it is one of them. */
  protected readonly selectedTab = computed(() => {
    const path = pathOf(this.url());
    return this.bottomPages.find((p) => p.url === path)?.url;
  });

  readonly bottomPages = BOTTOM_BAR_PAGES;

  constructor() {
    addIcons({
      homeOutline,
      homeSharp,
      pricetagOutline,
      pricetagSharp,
      heartOutline,
      heartSharp,
      downloadOutline,
      downloadSharp,
    });
    // Neither rejects: a setting that can't be read falls back to the default.
    void inject(LanguageService).init();
    void inject(ThemeService).init();
    inject(HardwareBackService).init();
    // Resume unfinished downloads in the background.
    inject(DownloadService).init().catch(() => undefined);
    // Download progress notification, and downloads kept going in the background.
    inject(DownloadNotificationService).init();
    // Keeps the device's and the nhentai account's favorites the same, once an API key is set.
    inject(FavoritesSyncService).init();
  }
}

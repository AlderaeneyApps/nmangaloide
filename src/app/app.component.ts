import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IsActiveMatchOptions, NavigationEnd, Params, Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonApp,
  IonSplitPane,
  IonMenu,
  IonContent,
  IonList,
  IonListHeader,
  IonNote,
  IonMenuToggle,
  IonItem,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonRouterLink,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import {
  downloadOutline,
  downloadSharp,
  heartOutline,
  heartSharp,
  pricetagOutline,
  pricetagSharp,
  settingsOutline,
  settingsSharp,
} from 'ionicons/icons';

import { filter, map } from 'rxjs';

import { BACK_PARAM } from './navigation';
import { LanguageService } from './services/language.service';

export interface AppPage {
  title: string;
  url: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonSplitPane,
    IonMenu,
    IonContent,
    IonList,
    IonListHeader,
    IonNote,
    IonMenuToggle,
    IonItem,
    IonIcon,
    IonLabel,
    IonRouterLink,
    IonRouterOutlet,
    TranslocoPipe,
  ],
})
export class AppComponent {
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);

  /** The current URL without its own `from` parameter, so back links don't nest. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => this.withoutBackParam(event.urlAfterRedirects)),
    ),
    { initialValue: this.withoutBackParam(this.router.url) },
  );

  /** Query params for each sidebar link: where to come back to (none for the current page). */
  protected readonly linkParams = computed<Record<string, Params | null>>(() => {
    const current = this.currentUrl();
    const currentPath = current.split('?')[0];
    return Object.fromEntries(
      this.appPages.map((page) => [page.url, page.url === currentPath ? null : { [BACK_PARAM]: current }]),
    );
  });

  /** A link stays highlighted whatever its query params are. */
  protected readonly activeOptions: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    fragment: 'ignored',
    matrixParams: 'ignored',
  };

  readonly appPages: AppPage[] = [
    { title: 'MENU.TAGS', url: '/tags', icon: 'pricetag' },
    { title: 'MENU.FAVORITES', url: '/favorites', icon: 'heart' },
    { title: 'MENU.DOWNLOADED', url: '/downloaded', icon: 'download' },
    { title: 'MENU.SETTINGS', url: '/settings', icon: 'settings' },
  ];

  constructor() {
    addIcons({
      pricetagOutline,
      pricetagSharp,
      heartOutline,
      heartSharp,
      downloadOutline,
      downloadSharp,
      settingsOutline,
      settingsSharp,
    });
    void this.language.init();
  }

  private withoutBackParam(url: string): string {
    const tree = this.router.parseUrl(url);
    delete tree.queryParams[BACK_PARAM];
    return this.router.serializeUrl(tree);
  }
}

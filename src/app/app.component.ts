import { Component, inject } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
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

import { HardwareBackService } from './services/hardware-back.service';
import { LanguageService } from './services/language.service';
import { ThemeService } from './services/theme.service';

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
    void inject(ThemeService).init();
    inject(HardwareBackService).init();
  }

}

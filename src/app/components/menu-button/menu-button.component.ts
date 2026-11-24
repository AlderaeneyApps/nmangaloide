import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonPopover, IonRouterLink } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { cloudDownloadOutline, cloudDownloadSharp, menuOutline, menuSharp, settingsOutline, settingsSharp } from 'ionicons/icons';

import { ACTIVE_OPTIONS, MENU_PAGES, injectOnTopLevelPage } from '../../app-pages';

/**
 * Header button opening a popover with the pages that aren't in the bottom bar.
 * Place it inside `<ion-buttons>`.
 */
@Component({
  selector: 'app-menu-button',
  templateUrl: './menu-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonPopover,
    IonRouterLink,
    TranslocoPipe,
  ],
})
export class MenuButtonComponent {
  protected readonly pages = MENU_PAGES;
  protected readonly activeOptions = ACTIVE_OPTIONS;
  protected readonly onTopLevelPage = injectOnTopLevelPage();

  protected readonly open = signal(false);
  protected readonly openEvent = signal<Event | null>(null);

  constructor() {
    addIcons({ menuOutline, menuSharp, cloudDownloadOutline, cloudDownloadSharp, settingsOutline, settingsSharp });
  }

  protected show(event: Event): void {
    this.openEvent.set(event);
    this.open.set(true);
  }

  protected hide(): void {
    this.open.set(false);
    this.openEvent.set(null);
  }
}

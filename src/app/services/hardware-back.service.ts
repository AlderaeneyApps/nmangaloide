import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { NavController, Platform } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { backUrlFor } from '../navigation';

/** Closes the app; a token so tests can replace it. */
export const EXIT_APP = new InjectionToken<() => Promise<void>>('EXIT_APP', {
  providedIn: 'root',
  factory: () => () => App.exitApp(),
});

/**
 * Below Ionic's menu (99) and overlay (100) handlers, so an open side menu,
 * dialog or popover is closed first; above Ionic's own navigation (0), which
 * this replaces.
 */
export const HARDWARE_BACK_PRIORITY = 10;

/**
 * Makes Android's back button/gesture follow the header back button's rules
 * (see backUrlFor), and close the app on the home page.
 */
@Injectable({ providedIn: 'root' })
export class HardwareBackService {
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);
  private readonly navController = inject(NavController);
  private readonly exitApp = inject(EXIT_APP);
  private subscription: Subscription | null = null;

  /** Starts handling the back button. Only Android has one; elsewhere this does nothing. */
  init(platform = Capacitor.getPlatform()): void {
    if (platform !== 'android' || this.subscription) {
      return;
    }
    this.subscription = this.platform.backButton.subscribeWithPriority(HARDWARE_BACK_PRIORITY, () => this.goBack());
  }

  /** What one press of the back button does on the current page. */
  goBack(): void {
    const target = backUrlFor(this.router.url);
    if (target === null) {
      void this.exitApp();
    } else {
      void this.navController.navigateBack(target);
    }
  }
}

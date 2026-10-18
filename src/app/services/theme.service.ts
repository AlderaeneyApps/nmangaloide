import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import { AppSettingsService } from './app-settings.service';

/** Class that switches on Ionic's dark palette (dark.class.css, imported in global.scss). */
export const DARK_CLASS = 'ion-palette-dark';
/** Extra class for the OLED black theme (see global.scss). */
export const OLED_CLASS = 'oled-black';

/**
 * Applies the theme chosen in Settings to the whole app. With "System" it
 * follows the phone's light/dark setting live; on Android/iOS it also sets the
 * status bar text to match.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(AppSettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly systemDark = signal(false);

  /** Whether the dark palette is in use right now. */
  readonly isDark = computed(() => {
    const theme = this.settings.theme();
    return theme === 'dark' || theme === 'oled' || (theme === 'system' && this.systemDark());
  });

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (media) {
      this.systemDark.set(media.matches);
      const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
      media.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener?.('change', onChange));
    }

    effect(() => this.apply(this.isDark(), this.settings.theme() === 'oled'));
  }

  /** Loads the saved theme. Until then (or if it can't be read) the phone's setting is used. */
  async init(): Promise<void> {
    try {
      await this.settings.load();
    } catch {
      // Keep the default "System" theme.
    }
  }

  private apply(dark: boolean, oled: boolean): void {
    const root = this.document.documentElement;
    root.classList.toggle(DARK_CLASS, dark);
    root.classList.toggle(OLED_CLASS, oled);
    // Native form controls and scrollbars follow the app, not the phone.
    root.style.colorScheme = dark ? 'dark' : 'light';

    if (Capacitor.isNativePlatform()) {
      // Style.Dark = light text, for dark backgrounds.
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    }
  }
}

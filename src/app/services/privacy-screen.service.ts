import { Injectable, InjectionToken, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen, PrivacyScreenConfig, PrivacyScreenPlugin } from '@capacitor/privacy-screen';

/** The privacy screen plugin; a token so tests can replace it. */
export const PRIVACY_SCREEN_PLUGIN = new InjectionToken<PrivacyScreenPlugin>('PRIVACY_SCREEN_PLUGIN', {
  providedIn: 'root',
  factory: () => PrivacyScreen,
});

/**
 * How the app is hidden in the app switcher / when it goes to the background.
 *
 * - iOS: `blurEffect: 'none'` makes the plugin cover the app with the `LaunchImage`
 *   asset, a plain dark grey image in `ios/App/App/Assets.xcassets/LaunchImage.imageset`
 *   (it takes precedence over `Splash`, so the launch screen is unchanged).
 * - Android: the plugin's "dim" cover is a full-screen black dialog (its only other
 *   option shows the launch splash image). The plugin also always sets FLAG_SECURE,
 *   which blanks the app switcher thumbnail and blocks screenshots in the app.
 */
export const PRIVACY_SCREEN_CONFIG: PrivacyScreenConfig = {
  android: {
    dimBackground: true,
    privacyModeOnActivityHidden: 'dim',
  },
  ios: {
    blurEffect: 'none',
  },
};

/** Hides the app's content in the app switcher on Android and iOS, whatever page is open. */
@Injectable({ providedIn: 'root' })
export class PrivacyScreenService {
  private readonly plugin = inject(PRIVACY_SCREEN_PLUGIN);

  /**
   * Turns the privacy screen on for the whole app. Does nothing in the browser,
   * where the plugin isn't available. Resolves true when it was enabled.
   */
  async enable(isNative = Capacitor.isNativePlatform()): Promise<boolean> {
    if (!isNative) {
      return false;
    }
    try {
      const { success } = await this.plugin.enable(PRIVACY_SCREEN_CONFIG);
      return success;
    } catch (error) {
      console.error('Could not enable the privacy screen', error);
      return false;
    }
  }
}

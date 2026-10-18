import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslocoService } from '@jsverse/transloco';

import { DEFAULT_LANG } from '../transloco-loader';

export interface LanguageOption {
  code: string;
  /** The language's name in that language, so users can always find their own. */
  name: string;
}

/** Display names for the languages in AVAILABLE_LANGS. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  ca: 'Català',
  fr: 'Français',
  de: 'Deutsch',
};

const LANG_SETTING_KEY = 'lang';

/**
 * Picks the app language on startup (saved setting, then device language, then
 * English) and saves the user's choice from the settings page.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly _current = signal<string>(DEFAULT_LANG);

  /** The active language code. */
  readonly current = this._current.asReadonly();

  /** The selectable languages, in the order they are configured. */
  get options(): LanguageOption[] {
    return this.availableLangs().map((code) => ({ code, name: LANGUAGE_NAMES[code] ?? code }));
  }

  /** Applies the saved language, or detects one from the device and saves it. */
  async init(): Promise<void> {
    let userLang = navigator.language;
    const settingLang = await this.getLangSetting();
    if (settingLang.value) {
      userLang = settingLang.value;
    }
    let primaryLang: string;
    if (userLang.includes('_')) {
      primaryLang = userLang.split('_')[0];
    } else if (userLang.includes('-')) {
      primaryLang = userLang.split('-')[0];
    } else {
      primaryLang = userLang;
    }
    const languageToSet = this.isAvailable(primaryLang) ? primaryLang : DEFAULT_LANG;
    this.activate(languageToSet);

    if (!settingLang.value) {
      await this.setLangSetting(languageToSet);
    }
  }

  /** Switches to `lang` and saves it as the user's setting. */
  async setLanguage(lang: string): Promise<void> {
    if (!this.isAvailable(lang)) {
      throw new Error(`Unsupported language: ${lang}`);
    }
    this.activate(lang);
    await this.setLangSetting(lang);
  }

  private activate(lang: string): void {
    this.transloco.setActiveLang(lang);
    this._current.set(lang);
  }

  private availableLangs(): string[] {
    return this.transloco
      .getAvailableLangs()
      .map((lang) => (typeof lang === 'string' ? lang : lang.id));
  }

  private isAvailable(lang: string): boolean {
    return this.availableLangs().includes(lang);
  }

  private async getLangSetting() {
    return await Preferences.get({
      key: LANG_SETTING_KEY,
    });
  }

  private async setLangSetting(lang: string) {
    await Preferences.set({
      key: LANG_SETTING_KEY,
      value: lang,
    });
  }
}

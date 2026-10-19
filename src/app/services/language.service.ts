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
  ja: '日本語',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

/** Regions whose Chinese is written in traditional characters (when the tag names no script). */
const TRADITIONAL_CHINESE_REGIONS = ['tw', 'hk', 'mo'];

/**
 * The supported language for a language tag such as `de-AT`, `pt_BR` or `zh-Hant-HK`,
 * or null. Chinese picks the script: `zh-Hant`, or a Taiwan / Hong Kong / Macau region,
 * means Traditional; anything else (`zh`, `zh-CN`, `zh-SG`, `zh-Hans-HK`) Simplified.
 */
export function matchLanguage(tag: string | null | undefined, available: readonly string[]): string | null {
  if (!tag) {
    return null;
  }
  const normalized = tag.trim().replace(/_/g, '-');
  const exact = available.find((code) => code.toLowerCase() === normalized.toLowerCase());
  if (exact) {
    return exact;
  }
  const [primary, ...rest] = normalized.toLowerCase().split('-');
  if (primary === 'zh') {
    const traditional =
      rest.includes('hant') || (!rest.includes('hans') && rest.some((part) => TRADITIONAL_CHINESE_REGIONS.includes(part)));
    const code = traditional ? 'zh-Hant' : 'zh-Hans';
    return available.includes(code) ? code : null;
  }
  return available.find((code) => code.toLowerCase() === primary) ?? null;
}

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

  /**
   * Applies the saved language, or detects one from the device and saves it: the
   * device's languages are tried in order of preference (so Chinese gets the right
   * script, and a second language is used if the first isn't translated), then English.
   */
  async init(): Promise<void> {
    const available = this.availableLangs();
    const saved = (await this.getLangSetting()).value;
    const fromSetting = matchLanguage(saved, available);
    const fromDevice = [navigator.language, ...(navigator.languages ?? [])]
      .map((tag) => matchLanguage(tag, available))
      .find((lang): lang is string => lang !== null);
    const languageToSet = fromSetting ?? fromDevice ?? DEFAULT_LANG;
    this.activate(languageToSet);

    if (!saved) {
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
    // Lets the web view pick Japanese, Simplified or Traditional Chinese glyphs for shared characters.
    document.documentElement.lang = lang;
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

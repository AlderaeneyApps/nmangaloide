import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { getTranslocoTestingModule } from '../testing/transloco-testing';
import { LanguageService, matchLanguage } from './language.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

// Capacitor Preferences uses localStorage on the web, under the "CapacitorStorage." prefix.
const SAVED = 'CapacitorStorage.lang';

describe('LanguageService', () => {
  let service: LanguageService;
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [getTranslocoTestingModule()] });
    service = TestBed.inject(LanguageService);
    transloco = TestBed.inject(TranslocoService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should list every configured language with its own name', () => {
    expect(service.options).toEqual([
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Español' },
      { code: 'ca', name: 'Català' },
      { code: 'fr', name: 'Français' },
      { code: 'de', name: 'Deutsch' },
      { code: 'ja', name: '日本語' },
      { code: 'zh-Hans', name: '简体中文' },
      { code: 'zh-Hant', name: '繁體中文' },
    ]);
  });

  it('should use the saved language on init', async () => {
    localStorage.setItem(SAVED, 'ca');
    await service.init();
    expect(transloco.getActiveLang()).toBe('ca');
    expect(service.current()).toBe('ca');
  });

  it('should detect and save the device language on first run', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT');
    await service.init();
    expect(service.current()).toBe('de');
    expect(localStorage.getItem(SAVED)).toBe('de');
  });

  it('should fall back to English for an unsupported device language', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ko_KR');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ko-KR']);
    await service.init();
    expect(service.current()).toBe('en');
    expect(localStorage.getItem(SAVED)).toBe('en');
  });

  it('should switch and save the language', async () => {
    await service.setLanguage('es');
    expect(transloco.getActiveLang()).toBe('es');
    expect(service.current()).toBe('es');
    expect(localStorage.getItem(SAVED)).toBe('es');
  });

  it('should reject unsupported languages without changing anything', async () => {
    await expect(service.setLanguage('xx')).rejects.toThrow('Unsupported language: xx');
    expect(service.current()).toBe('en');
    expect(localStorage.getItem(SAVED)).toBeNull();
  });

  it('detects Japanese and the right Chinese script on first run', async () => {
    const cases: [string, string][] = [
      ['ja-JP', 'ja'],
      ['zh-CN', 'zh-Hans'],
      ['zh-TW', 'zh-Hant'],
      ['zh_HK', 'zh-Hant'],
      ['zh-Hant-TW', 'zh-Hant'],
      ['zh', 'zh-Hans'],
    ];
    for (const [device, expected] of cases) {
      localStorage.clear();
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(device);
      await service.init();
      expect(service.current()).toBe(expected);
      expect(localStorage.getItem(SAVED)).toBe(expected);
      expect(document.documentElement.lang).toBe(expected);
    }
  });

  it("tries the device's other languages before falling back to English", async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ko-KR');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ko-KR', 'zh-Hant-HK', 'en-US']);
    await service.init();
    expect(service.current()).toBe('zh-Hant');
  });

  it('keeps a saved Chinese variant', async () => {
    localStorage.setItem(SAVED, 'zh-Hant');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
    await service.init();
    expect(service.current()).toBe('zh-Hant');
  });

  it('can switch to the new languages', async () => {
    await service.setLanguage('ja');
    expect(transloco.getActiveLang()).toBe('ja');
    await service.setLanguage('zh-Hans');
    expect(localStorage.getItem(SAVED)).toBe('zh-Hans');
  });
});

describe('matchLanguage', () => {
  const available = ['en', 'es', 'ja', 'zh-Hans', 'zh-Hant'];

  it('maps Chinese tags to the script their region uses', () => {
    expect(matchLanguage('zh-CN', available)).toBe('zh-Hans');
    expect(matchLanguage('zh-SG', available)).toBe('zh-Hans');
    expect(matchLanguage('zh-Hans-HK', available)).toBe('zh-Hans');
    expect(matchLanguage('zh-MO', available)).toBe('zh-Hant');
    expect(matchLanguage('ZH-hant', available)).toBe('zh-Hant');
    expect(matchLanguage('zh-CN', ['en'])).toBeNull();
  });

  it('matches other languages by their primary tag', () => {
    expect(matchLanguage('es-MX', available)).toBe('es');
    expect(matchLanguage('ja_JP', available)).toBe('ja');
    expect(matchLanguage('ko', available)).toBeNull();
    expect(matchLanguage('', available)).toBeNull();
    expect(matchLanguage(null, available)).toBeNull();
  });
});

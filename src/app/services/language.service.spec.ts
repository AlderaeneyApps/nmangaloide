import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { getTranslocoTestingModule } from '../testing/transloco-testing';
import { LanguageService } from './language.service';

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
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja_JP');
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
});

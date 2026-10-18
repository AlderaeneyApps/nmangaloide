import { TestBed } from '@angular/core/testing';

import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { AppSettingsService } from './app-settings.service';
import { DARK_CLASS, OLED_CLASS, ThemeService } from './theme.service';

describe('ThemeService', () => {
  let db: FakeDatabase;
  let systemDark: boolean;
  let listener: ((event: MediaQueryListEvent) => void) | null;

  beforeEach(() => {
    db = new FakeDatabase();
    systemDark = false;
    listener = null;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: systemDark,
          media: query,
          addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => (listener = fn),
          removeEventListener: () => (listener = null),
        }) as unknown as MediaQueryList,
    );
    TestBed.configureTestingModule({ providers: [provideFakeDatabase(db)] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove(DARK_CLASS, OLED_CLASS);
    document.documentElement.style.colorScheme = '';
  });

  const root = () => document.documentElement;
  async function start() {
    const service = TestBed.inject(ThemeService);
    await service.init();
    TestBed.tick();
    return service;
  }

  it('follows the phone when set to System', async () => {
    systemDark = true;
    await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(true);
    expect(root().classList.contains(OLED_CLASS)).toBe(false);
    expect(root().style.colorScheme).toBe('dark');
  });

  it('switches live when the phone changes between light and dark', async () => {
    await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(false);

    listener!({ matches: true } as MediaQueryListEvent);
    TestBed.tick();
    expect(root().classList.contains(DARK_CLASS)).toBe(true);

    listener!({ matches: false } as MediaQueryListEvent);
    TestBed.tick();
    expect(root().classList.contains(DARK_CLASS)).toBe(false);
  });

  it('stays light when set to Light, even on a dark phone', async () => {
    systemDark = true;
    db.settings.set('theme', 'light');
    await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(false);
    expect(root().style.colorScheme).toBe('light');
  });

  it('stays dark when set to Dark, even on a light phone', async () => {
    db.settings.set('theme', 'dark');
    const service = await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(true);
    expect(root().classList.contains(OLED_CLASS)).toBe(false);
    expect(service.isDark()).toBe(true);
  });

  it('uses the dark palette plus pure black for OLED black', async () => {
    db.settings.set('theme', 'oled');
    await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(true);
    expect(root().classList.contains(OLED_CLASS)).toBe(true);
  });

  it('applies a newly chosen theme straight away', async () => {
    await start();
    await TestBed.inject(AppSettingsService).setTheme('oled');
    TestBed.tick();
    expect(root().classList.contains(OLED_CLASS)).toBe(true);

    await TestBed.inject(AppSettingsService).setTheme('light');
    TestBed.tick();
    expect(root().classList.contains(DARK_CLASS)).toBe(false);
    expect(root().classList.contains(OLED_CLASS)).toBe(false);
  });

  it('falls back to the phone setting when the saved theme cannot be read', async () => {
    systemDark = true;
    db.failNext = new Error('locked');
    await start();
    expect(root().classList.contains(DARK_CLASS)).toBe(true);
  });
});

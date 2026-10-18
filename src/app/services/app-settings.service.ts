import { Injectable, inject, signal } from '@angular/core';

import { DatabaseService } from '../sql-services/database.service';

/** How the reader shows a gallery: all pages in one vertical scroll, or one page at a time. */
export type ReaderMode = 'scroll' | 'paged';
export const READER_MODES: readonly ReaderMode[] = ['scroll', 'paged'];
export const DEFAULT_READER_MODE: ReaderMode = 'scroll';

/** The app's colours: follow the phone, always light, always dark, or dark on pure black. */
export type AppTheme = 'system' | 'light' | 'dark' | 'oled';
export const APP_THEMES: readonly AppTheme[] = ['system', 'light', 'dark', 'oled'];
export const DEFAULT_THEME: AppTheme = 'system';

const READER_MODE_KEY = 'reader_mode';
const THEME_KEY = 'theme';

interface SettingRow {
  key: string;
  value: string;
}

/** App settings kept in the `app_settings` SQLite table (one row per setting). */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly db = inject(DatabaseService);
  private readonly _readerMode = signal<ReaderMode>(DEFAULT_READER_MODE);
  private readonly _theme = signal<AppTheme>(DEFAULT_THEME);
  private loading: Promise<void> | null = null;

  readonly readerMode = this._readerMode.asReadonly();
  readonly theme = this._theme.asReadonly();

  /** Reads the settings from the database (once; later calls reuse the result). */
  load(): Promise<void> {
    this.loading ??= this.db.query<SettingRow>('SELECT key, value FROM app_settings').then(
      (rows) => {
        const settings = new Map(rows.map((row) => [row.key, row.value]));
        const mode = settings.get(READER_MODE_KEY);
        this._readerMode.set(isReaderMode(mode) ? mode : DEFAULT_READER_MODE);
        const theme = settings.get(THEME_KEY);
        this._theme.set(isTheme(theme) ? theme : DEFAULT_THEME);
      },
      (error) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }

  /** Re-reads the settings, e.g. after a backup was imported. */
  reload(): Promise<void> {
    this.loading = null;
    return this.load();
  }

  async setReaderMode(mode: ReaderMode): Promise<void> {
    if (!isReaderMode(mode)) {
      throw new Error(`Unknown reader mode: ${mode}`);
    }
    await this.save(READER_MODE_KEY, mode);
    this._readerMode.set(mode);
  }

  async setTheme(theme: AppTheme): Promise<void> {
    if (!isTheme(theme)) {
      throw new Error(`Unknown theme: ${theme}`);
    }
    await this.save(THEME_KEY, theme);
    this._theme.set(theme);
  }

  private save(key: string, value: string): Promise<void> {
    return this.db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }
}

function isReaderMode(value: unknown): value is ReaderMode {
  return READER_MODES.includes(value as ReaderMode);
}

function isTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme);
}

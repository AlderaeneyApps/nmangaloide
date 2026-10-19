import { InjectionToken } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

export interface FileSaverSaveOptions {
  /** Suggested file name; the user can change it in the picker. */
  fileName: string;
  /**
   * URI of the file to save, which must be in the app's cache folder
   * (Filesystem Directory.Cache). The contents aren't passed directly: on Android
   * a large call would be stored in the activity's saved state while the picker is
   * open and crash the app (TransactionTooLargeException).
   */
  sourceUri: string;
  mimeType?: string;
}

/**
 * The app's own native plugin (android/app/src/main/java/com/alderaeney/FileSaverPlugin.java,
 * ios/App/App/FileSaverPlugin.swift): shows the system "Save as" picker so the user
 * chooses where the file goes. Rejects with code `CANCELLED` when the picker is closed.
 */
export interface FileSaverPlugin {
  saveAs(options: FileSaverSaveOptions): Promise<{ uri: string }>;
}

export const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver');

/** The FileSaver plugin; a token so tests can replace it. A plain object (see DOWNLOAD_KEEP_ALIVE). */
export const FILE_SAVER = new InjectionToken<FileSaverPlugin>('FILE_SAVER', {
  providedIn: 'root',
  factory: () => ({ saveAs: (options) => FileSaver.saveAs(options) }),
});

/** Whether `error` means the user closed a picker or share sheet without choosing. */
export function isCancelled(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'CANCELLED') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

/** Writes and removes files in the app's cache folder; a token so tests can replace it. */
export interface CacheFiles {
  /** Writes text to `name` in the cache folder and resolves with its URI. */
  write(name: string, data: string): Promise<string>;
  remove(name: string): Promise<void>;
}

export const CACHE_FILES = new InjectionToken<CacheFiles>('CACHE_FILES', {
  providedIn: 'root',
  factory: () => ({
    write: async (name, data) =>
      (await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 })).uri,
    remove: (name) => Filesystem.deleteFile({ path: name, directory: Directory.Cache }),
  }),
});

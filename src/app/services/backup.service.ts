import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

import { CACHE_FILES, FILE_SAVER } from '../native/file-saver';
import { DatabaseService } from '../sql-services/database.service';
import { AppSettingsService } from './app-settings.service';
import { DownloadService } from './download.service';
import { SavedGalleriesService } from './saved-galleries.service';
import { TagPreferencesService } from './tag-preferences.service';

/**
 * Where an export goes on Android/iOS: `device` opens the system "Save as" picker
 * (any folder on the phone, an SD card, iCloud/Drive…), `share` the share sheet.
 */
export type ExportDestination = 'device' | 'share';

/** Exports the database to a JSON file and imports it back. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly database = inject(DatabaseService);
  private readonly tagPreferences = inject(TagPreferencesService);
  private readonly settings = inject(AppSettingsService);
  private readonly savedGalleries = inject(SavedGalleriesService);
  private readonly downloads = inject(DownloadService);
  private readonly fileSaver = inject(FILE_SAVER);
  private readonly cacheFiles = inject(CACHE_FILES);

  /**
   * Exports the database. On Android/iOS it's saved where the user picks
   * (`device`) or handed to the share sheet (`share`); in the browser it's
   * downloaded. Resolves with the file name.
   */
  async exportToFile(destination: ExportDestination = 'device', now = new Date()): Promise<string> {
    const json = await this.database.exportJson();
    const fileName = backupFileName(now);
    if (Capacitor.isNativePlatform()) {
      // Both paths hand the native side a file in the cache, never the contents:
      // a large plugin call can crash Android while another app is open on top.
      const uri = await this.cacheFiles.write(fileName, json);
      if (destination === 'device') {
        try {
          await this.fileSaver.saveAs({ fileName, sourceUri: uri, mimeType: 'application/json' });
        } finally {
          // Copied (or cancelled) by now. Shared files are left for the cache to clear:
          // the receiving app may still be reading them after the share sheet closes.
          await this.cacheFiles.remove(fileName).catch(() => undefined);
        }
      } else {
        await Share.share({ title: fileName, files: [uri] });
      }
    } else {
      downloadFile(fileName, json);
    }
    return fileName;
  }

  /** Replaces the database with the backup in `file`, then reloads what the app shows. */
  async importFromFile(file: Blob): Promise<void> {
    await this.database.importJson(await file.text());
    // Backups don't contain downloaded pages, so imported downloads are cleared.
    await this.downloads.resetAfterImport();
    await Promise.all([this.tagPreferences.reload(), this.settings.reload(), this.savedGalleries.reload()]);
  }
}

/** e.g. `nmangaloide-backup-2026-10-18.json` (local date). */
export function backupFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `nmangaloide-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

function downloadFile(fileName: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

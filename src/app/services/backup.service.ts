import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import { DatabaseService } from '../sql-services/database.service';
import { TagPreferencesService } from './tag-preferences.service';

/** Exports the database to a JSON file and imports it back. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly database = inject(DatabaseService);
  private readonly tagPreferences = inject(TagPreferencesService);

  /**
   * Exports the database. On Android/iOS the file is written to the app's cache
   * and handed to the share sheet (save to Files, send, ...); in the browser it's
   * downloaded. Resolves with the file name.
   */
  async exportToFile(now = new Date()): Promise<string> {
    const json = await this.database.exportJson();
    const fileName = backupFileName(now);
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: fileName,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({ title: fileName, files: [uri] });
    } else {
      downloadFile(fileName, json);
    }
    return fileName;
  }

  /** Replaces the database with the backup in `file`, then reloads what the app shows. */
  async importFromFile(file: Blob): Promise<void> {
    await this.database.importJson(await file.text());
    await this.tagPreferences.reload();
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

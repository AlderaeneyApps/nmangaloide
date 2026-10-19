import { Injectable, computed, inject, signal } from '@angular/core';

import { DEVICE_PREFERENCES, DOWNLOAD_STORAGE, PickedFolder } from '../native/download-folder';

const FOLDER_KEY = 'download_folder';

/**
 * The folder downloads are saved to. On Android the user picks it (and it's kept on
 * this device only, not in backups: the folder belongs to this phone); on iOS it's
 * the app's folder in the Files app, and in the browser its storage.
 */
@Injectable({ providedIn: 'root' })
export class DownloadFolderService {
  private readonly storage = inject(DOWNLOAD_STORAGE);
  private readonly preferences = inject(DEVICE_PREFERENCES);
  private readonly _folder = signal<PickedFolder | null>(null);
  private loading: Promise<void> | null = null;

  readonly kind = this.storage.kind;
  /** Whether the user has to choose the folder (Android). */
  readonly needsPicking = this.storage.kind === 'picked';
  /** The chosen folder (Android only). */
  readonly folder = this._folder.asReadonly();
  /** Whether downloads can be saved. */
  readonly ready = computed(() => !this.needsPicking || this._folder() !== null);
  /** The `root` for DownloadStorage calls. */
  readonly root = computed(() => this._folder()?.uri ?? null);

  /** Reads the chosen folder, forgetting it if the app lost access. Once; later calls reuse the result. */
  load(): Promise<void> {
    this.loading ??= this.read().catch(() => this._folder.set(null));
    return this.loading;
  }

  /** Shows the folder picker and keeps the chosen folder. Rejects with code CANCELLED if closed. */
  async pick(): Promise<PickedFolder> {
    const folder = await this.storage.pick();
    await this.preferences.set(FOLDER_KEY, JSON.stringify(folder));
    this._folder.set(folder);
    this.loading = Promise.resolve();
    return folder;
  }

  private async read(): Promise<void> {
    if (!this.needsPicking) {
      return;
    }
    const saved = parseFolder(await this.preferences.get(FOLDER_KEY));
    if (saved && (await this.storage.hasAccess(saved.uri).catch(() => false))) {
      this._folder.set(saved);
    } else {
      this._folder.set(null);
    }
  }
}

function parseFolder(value: string | null): PickedFolder | null {
  try {
    const folder = value ? (JSON.parse(value) as Partial<PickedFolder>) : null;
    return folder && typeof folder.uri === 'string' && typeof folder.name === 'string'
      ? { uri: folder.uri, name: folder.name }
      : null;
  } catch {
    return null;
  }
}

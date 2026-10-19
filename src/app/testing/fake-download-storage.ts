import { base64ToBytes, bytesToBase64, concat } from '../native/cbz';
import {
  APP_FILES,
  AppFiles,
  AppFilesArea,
  DEVICE_PREFERENCES,
  DOWNLOAD_STORAGE,
  DownloadStorage,
  DownloadStorageKind,
  FolderEntry,
  PickedFolder,
} from '../native/download-folder';

/**
 * In-memory download folder for specs. Files are kept by their full path
 * (`<root>/<folder>/<name>`); `pickResult` is what the folder picker returns.
 */
export class FakeDownloadStorage implements DownloadStorage {
  /** File contents (base64) by path, e.g. `content://tree/42/001.webp`. */
  readonly files = new Map<string, { data: string; mimeType: string }>();
  pickResult: PickedFolder | Error = { uri: 'content://tree', name: 'Comics' };
  /** Folders the app has access to; `hasAccess` is false for anything else. */
  readonly accessible = new Set<string>(['content://tree']);
  readonly picks: number[] = [];

  constructor(readonly kind: DownloadStorageKind = 'picked') {}

  async pick(): Promise<PickedFolder> {
    this.picks.push(Date.now());
    if (this.pickResult instanceof Error) {
      throw this.pickResult;
    }
    this.accessible.add(this.pickResult.uri);
    return this.pickResult;
  }

  async hasAccess(root: string): Promise<boolean> {
    return this.accessible.has(root);
  }

  async list(root: string | null, path: string[]): Promise<FolderEntry[]> {
    const prefix = this.key(root, path) + '/';
    const entries = new Map<string, FolderEntry>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const [name, ...rest] = key.slice(prefix.length).split('/');
      entries.set(name, { name, type: rest.length ? 'directory' : 'file', uri: prefix + name });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async write(root: string | null, path: string[], name: string, data: string, mimeType: string): Promise<void> {
    this.files.set(this.key(root, [...path, name]), { data, mimeType });
  }

  async read(root: string | null, path: string[], name: string): Promise<string> {
    const file = this.files.get(this.key(root, [...path, name]));
    if (!file) {
      throw new Error(`No such file: ${name}`);
    }
    return file.data;
  }

  async remove(root: string | null, path: string[]): Promise<void> {
    const target = this.key(root, path);
    for (const key of [...this.files.keys()]) {
      if (key === target || key.startsWith(target + '/')) {
        this.files.delete(key);
      }
    }
  }

  async append(root: string | null, path: string[], name: string, data: string): Promise<void> {
    const key = this.key(root, [...path, name]);
    const existing = this.files.get(key);
    const bytes = existing ? concat([base64ToBytes(existing.data), base64ToBytes(data)]) : base64ToBytes(data);
    this.files.set(key, { data: bytesToBase64(bytes), mimeType: existing?.mimeType ?? 'application/octet-stream' });
  }

  async rename(root: string | null, path: string[], from: string, to: string): Promise<void> {
    const file = this.files.get(this.key(root, [...path, from]));
    if (!file) {
      throw new Error(`No such file: ${from}`);
    }
    this.files.delete(this.key(root, [...path, from]));
    this.files.set(this.key(root, [...path, to]), file);
  }

  async readBytes(root: string | null, path: string[], entry: FolderEntry): Promise<Uint8Array> {
    return base64ToBytes(await this.read(root, path, entry.name));
  }

  /** Puts a file in the folder directly. */
  seed(root: string | null, path: string, data = 'AAAA', mimeType = 'image/webp'): void {
    this.files.set(`${root ?? 'app'}/${path}`, { data, mimeType });
  }

  /** Names of the files in a gallery's folder. */
  namesIn(root: string | null, folder: string): string[] {
    const prefix = `${root ?? 'app'}/${folder}/`;
    return [...this.files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
  }

  private key(root: string | null, path: string[]): string {
    return [root ?? 'app', ...path].join('/');
  }
}

/** In-memory APP_FILES: `files` by `<area>/<dir>/<name>`. Image URLs are `app-src:<area>/<dir>/<name>`. */
export class FakeAppFiles implements AppFiles {
  readonly files = new Map<string, string>();

  async write(area: AppFilesArea, dir: string, name: string, data: string): Promise<string> {
    this.files.set(`${area}/${dir}/${name}`, data);
    return `app-src:${area}/${dir}/${name}`;
  }

  async list(area: AppFilesArea, dir: string): Promise<string[]> {
    const prefix = `${area}/${dir}/`;
    return [...this.files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
  }

  async dirs(area: AppFilesArea): Promise<string[]> {
    const prefix = `${area}/`;
    return [...new Set([...this.files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.split('/')[1]))];
  }

  async read(area: AppFilesArea, dir: string, name: string): Promise<string> {
    const data = this.files.get(`${area}/${dir}/${name}`);
    if (data === undefined) {
      throw new Error(`No such file: ${name}`);
    }
    return data;
  }

  async remove(area: AppFilesArea, dir?: string): Promise<void> {
    const prefix = dir ? `${area}/${dir}/` : `${area}/`;
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) {
        this.files.delete(key);
      }
    }
  }

  /** Keys in an area (`<dir>/<name>`). */
  keys(area: AppFilesArea): string[] {
    return [...this.files.keys()].filter((key) => key.startsWith(`${area}/`)).map((key) => key.slice(area.length + 1)).sort();
  }
}

/** In-memory DEVICE_PREFERENCES. */
export class FakePreferences {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/** The folder picked in specs, as saved in the device preferences. */
export const TEST_FOLDER = { uri: 'content://tree', name: 'Comics' };

/**
 * Providers for the download folder: in-memory storage and preferences. With
 * `folderChosen`, the folder is already picked (Android) when the app starts.
 */
export function provideFakeDownloads(
  storage = new FakeDownloadStorage(),
  preferences = new FakePreferences(),
  folderChosen = true,
  appFiles = new FakeAppFiles(),
) {
  if (folderChosen && storage.kind === 'picked') {
    preferences.values.set('download_folder', JSON.stringify(TEST_FOLDER));
  }
  return [
    { provide: DOWNLOAD_STORAGE, useValue: storage },
    { provide: DEVICE_PREFERENCES, useValue: preferences },
    { provide: APP_FILES, useValue: appFiles },
  ];
}

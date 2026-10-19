import { InjectionToken } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

/** A file or folder inside the downloads folder. */
export interface FolderEntry {
  name: string;
  type: 'file' | 'directory';
  /** Native URI of the entry (a `content://` document on Android, `file://` on iOS). */
  uri: string;
}

/** A folder the user picked for the downloads. */
export interface PickedFolder {
  /** Android tree URI, kept to reach the folder again. */
  uri: string;
  /** Shown to the user. */
  name: string;
}

/**
 * The app's own Android plugin (android/app/src/main/java/com/alderaeney/DownloadFolderPlugin.java):
 * the folder picker and file access in the picked folder (Storage Access Framework).
 * `path` is a list of folder names below the picked folder. `pick()` rejects with
 * code `CANCELLED` when the picker is closed.
 */
export interface DownloadFolderPlugin {
  pick(): Promise<PickedFolder>;
  hasAccess(options: { uri: string }): Promise<{ granted: boolean }>;
  list(options: { uri: string; path: string[] }): Promise<{ entries: FolderEntry[] }>;
  writeFile(options: { uri: string; path: string[]; name: string; data: string; mimeType: string }): Promise<{ uri: string }>;
  appendFile(options: { uri: string; path: string[]; name: string; data: string }): Promise<void>;
  rename(options: { uri: string; path: string[]; from: string; to: string }): Promise<{ uri: string }>;
  readFile(options: { uri: string; path: string[]; name: string }): Promise<{ data: string }>;
  remove(options: { uri: string; path: string[] }): Promise<void>;
}

export const DownloadFolder = registerPlugin<DownloadFolderPlugin>('DownloadFolder');

/**
 * Where downloads are kept:
 * - `picked`: a folder the user chooses (Android), so it can be any folder on the phone.
 * - `files-app`: the app's own folder, shown in the Files app (iOS, "On My iPhone").
 * - `browser`: the browser's storage (web builds), not a real folder.
 */
export type DownloadStorageKind = 'picked' | 'files-app' | 'browser';

/**
 * File access in the download folder. `root` is the picked folder's URI (`picked`),
 * ignored otherwise. `path` is a list of folder names below the download folder.
 */
export interface DownloadStorage {
  readonly kind: DownloadStorageKind;
  /** Shows the folder picker (only for `picked`). */
  pick(): Promise<PickedFolder>;
  /** Whether the app can still use the folder (the user can revoke access or delete it). */
  hasAccess(root: string): Promise<boolean>;
  /** The entries in a folder; empty if it doesn't exist. */
  list(root: string | null, path: string[]): Promise<FolderEntry[]>;
  /** Writes base64 data, creating folders as needed and replacing an existing file. */
  write(root: string | null, path: string[], name: string, base64: string, mimeType: string): Promise<void>;
  /** Adds base64 data to the end of a file (created if missing). */
  append(root: string | null, path: string[], name: string, base64: string): Promise<void>;
  /** Renames a file, replacing any file already called `to`. */
  rename(root: string | null, path: string[], from: string, to: string): Promise<void>;
  /** A small file's contents as base64. */
  read(root: string | null, path: string[], name: string): Promise<string>;
  /** A (possibly large) file's contents, without going through base64 where possible. */
  readBytes(root: string | null, path: string[], entry: FolderEntry): Promise<Uint8Array>;
  /** Deletes a file, or a folder with its contents (no error if it's not there). */
  remove(root: string | null, path: string[]): Promise<void>;
}

/** Reads a native file through the web view's own server (no base64 round trip). */
async function fetchBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(Capacitor.convertFileSrc(uri));
  if (!response.ok) {
    throw new Error(`Could not read ${uri} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The download folder plugin on Android. */
export function pickedFolderStorage(plugin: DownloadFolderPlugin = DownloadFolder): DownloadStorage {
  const need = (root: string | null) => {
    if (!root) {
      throw new Error('No download folder chosen');
    }
    return root;
  };
  return {
    kind: 'picked',
    pick: () => plugin.pick(),
    hasAccess: async (root) => (await plugin.hasAccess({ uri: root })).granted,
    list: async (root, path) => (await plugin.list({ uri: need(root), path })).entries,
    write: async (root, path, name, data, mimeType) => {
      await plugin.writeFile({ uri: need(root), path, name, data, mimeType });
    },
    append: (root, path, name, data) => plugin.appendFile({ uri: need(root), path, name, data }),
    rename: async (root, path, from, to) => {
      await plugin.rename({ uri: need(root), path, from, to });
    },
    read: async (root, path, name) => (await plugin.readFile({ uri: need(root), path, name })).data,
    readBytes: async (root, path, entry) => {
      try {
        return await fetchBytes(entry.uri);
      } catch {
        // Through the plugin instead (slower: base64 over the bridge).
        return base64ToBytesLocal((await plugin.readFile({ uri: need(root), path, name: entry.name })).data);
      }
    },
    remove: (root, path) => plugin.remove({ uri: need(root), path }),
  };
}

/**
 * Capacitor Filesystem: the app's Documents folder on iOS (shown in the Files app when
 * UIFileSharingEnabled is set), or a `downloads` folder in the browser's storage.
 */
export function appFolderStorage(kind: 'files-app' | 'browser'): DownloadStorage {
  const directory = kind === 'files-app' ? Directory.Documents : Directory.Data;
  const base = kind === 'files-app' ? [] : ['downloads'];
  const pathOf = (path: string[], name?: string) => [...base, ...path, ...(name ? [name] : [])].join('/');
  const read = async (path: string[], name: string) => {
    const { data } = await Filesystem.readFile({ path: pathOf(path, name), directory });
    return typeof data === 'string' ? data : stripDataUrl(await blobToDataUrlString(data));
  };
  return {
    kind,
    pick: () => Promise.reject(new Error('Downloads are kept in the app folder')),
    hasAccess: async () => true,
    list: async (_root, path) => {
      try {
        const { files } = await Filesystem.readdir({ path: pathOf(path), directory });
        return files.map((file) => ({ name: file.name, type: file.type, uri: file.uri }));
      } catch {
        return [];
      }
    },
    write: async (_root, path, name, data) => {
      await Filesystem.writeFile({ path: pathOf(path, name), data, directory, recursive: true });
    },
    append: (_root, path, name, data) => Filesystem.appendFile({ path: pathOf(path, name), data, directory }),
    rename: async (_root, path, from, to) => {
      await Filesystem.deleteFile({ path: pathOf(path, to), directory }).catch(() => undefined);
      await Filesystem.rename({ from: pathOf(path, from), to: pathOf(path, to), directory, toDirectory: directory });
    },
    read: (_root, path, name) => read(path, name),
    readBytes: async (_root, path, entry) =>
      kind === 'files-app' ? fetchBytes(entry.uri) : base64ToBytesLocal(await read(path, entry.name)),
    remove: async (_root, path) => {
      const target = { path: pathOf(path), directory };
      try {
        const { type } = await Filesystem.stat(target);
        await (type === 'directory' ? Filesystem.rmdir({ ...target, recursive: true }) : Filesystem.deleteFile(target));
      } catch {
        // Not there.
      }
    },
  };
}

/** The storage for the platform the app runs on; a token so tests can replace it. */
export const DOWNLOAD_STORAGE = new InjectionToken<DownloadStorage>('DOWNLOAD_STORAGE', {
  providedIn: 'root',
  factory: () => {
    switch (Capacitor.getPlatform()) {
      case 'android':
        return pickedFolderStorage();
      case 'ios':
        return appFolderStorage('files-app');
      default:
        return appFolderStorage('browser');
    }
  },
});

/**
 * The app's private files, never seen by the user, the gallery/Photos apps or the Files app:
 * - `staging`: pages of downloads in progress (kept across restarts, until the CBZ is written);
 * - `reader`: pages unpacked from a CBZ while it's being read (temporary).
 * `dir` is a folder name inside the area (the gallery id).
 */
export type AppFilesArea = 'staging' | 'reader';

export interface AppFiles {
  /** Writes a file and resolves with a URL an `<img>` can show. */
  write(area: AppFilesArea, dir: string, name: string, base64: string): Promise<string>;
  /** File names in a folder; empty if it doesn't exist. */
  list(area: AppFilesArea, dir: string): Promise<string[]>;
  /** Folder names in an area. */
  dirs(area: AppFilesArea): Promise<string[]>;
  read(area: AppFilesArea, dir: string, name: string): Promise<string>;
  /** Deletes a folder (or the whole area without `dir`). */
  remove(area: AppFilesArea, dir?: string): Promise<void>;
}

export function filesystemAppFiles(platform = Capacitor.getPlatform()): AppFiles {
  const where = (area: AppFilesArea) =>
    area === 'staging'
      ? { directory: Directory.LibraryNoCloud, base: 'downloading' }
      : { directory: Directory.Cache, base: 'reader' };
  const pathOf = (area: AppFilesArea, ...parts: string[]) => [where(area).base, ...parts].join('/');
  const read = async (area: AppFilesArea, dir: string, name: string) => {
    const { data } = await Filesystem.readFile({ path: pathOf(area, dir, name), directory: where(area).directory });
    return typeof data === 'string' ? data : stripDataUrl(await blobToDataUrlString(data));
  };
  const entries = async (area: AppFilesArea, ...parts: string[]) => {
    try {
      return (await Filesystem.readdir({ path: pathOf(area, ...parts), directory: where(area).directory })).files;
    } catch {
      return [];
    }
  };
  return {
    write: async (area, dir, name, data) => {
      const { uri } = await Filesystem.writeFile({
        path: pathOf(area, dir, name),
        data,
        directory: where(area).directory,
        recursive: true,
      });
      // The browser has no file URLs: show the data itself.
      return platform === 'web' ? `data:${mimeTypeOf(name)};base64,${data}` : Capacitor.convertFileSrc(uri);
    },
    list: async (area, dir) => (await entries(area, dir)).filter((file) => file.type === 'file').map((file) => file.name),
    dirs: async (area) => (await entries(area)).filter((file) => file.type === 'directory').map((file) => file.name),
    read,
    remove: async (area, dir) => {
      try {
        await Filesystem.rmdir({ path: dir ? pathOf(area, dir) : pathOf(area), directory: where(area).directory, recursive: true });
      } catch {
        // Not there.
      }
    },
  };
}

export const APP_FILES = new InjectionToken<AppFiles>('APP_FILES', {
  providedIn: 'root',
  factory: () => filesystemAppFiles(),
});

function base64ToBytesLocal(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Small key/value settings kept only on this device (not in backups); a token so tests can replace it. */
export interface DevicePreferences {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const DEVICE_PREFERENCES = new InjectionToken<DevicePreferences>('DEVICE_PREFERENCES', {
  providedIn: 'root',
  factory: () => ({
    get: async (key) => (await Preferences.get({ key })).value,
    set: (key, value) => Preferences.set({ key, value }),
    remove: (key) => Preferences.remove({ key }),
  }),
});

const MIME_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
  json: 'application/json',
};

export function mimeTypeOf(fileName: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToDataUrlString(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** UTF-8 text as base64. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 back to UTF-8 text. */
export function base64ToText(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

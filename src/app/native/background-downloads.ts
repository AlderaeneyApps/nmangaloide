import { InjectionToken } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** A comic handed over to the native downloader. */
export interface NativeDownloadJob {
  id: number;
  title: string;
  /** The download folder (Android tree URI) the CBZ is written to; unused on iOS (always Documents). */
  folderUri: string;
  /** Contents of gallery.json and ComicInfo.xml in the CBZ. */
  detailsJson: string;
  comicInfoXml: string;
  /** Wait between pages, in milliseconds. */
  delayMs: number;
  /** Page images, saved as `fileName` in the staging folder and in the CBZ. */
  pages: { number: number; url: string; fileName: string }[];
}

export type NativeDownloadStatus = 'queued' | 'downloading' | 'failed' | 'finished';

/** A comic's state in the native downloader; `finished` means its CBZ is in the download folder. */
export interface NativeDownloadState {
  id: number;
  done: number;
  total: number;
  status: NativeDownloadStatus;
}

/** Notification texts; `{count}`, `{done}`, `{total}` and `{title}` are filled in natively. */
export interface NativeDownloadLabels {
  titleOne: string;
  titleOther: string;
  body: string;
  channel: string;
}

/**
 * The app's own native downloader, so downloads keep going with the app in the background,
 * the screen off or the app closed (the web view is paused, frozen or destroyed then). Pages
 * go to the same staging folder the app uses, and the CBZ to the download folder.
 *
 * - Android (BackgroundDownloadsPlugin.java): downloads run in a foreground service.
 *   `enqueue()` rejects with code `NOT_ALLOWED` when Android doesn't allow starting the
 *   service (the app is in the background); the job then waits for the next `enqueue()`.
 * - iOS (BackgroundDownloadsPlugin.swift): downloads run in a background URLSession, done by
 *   iOS itself; the CBZ goes to the app's Documents folder. A comic whose CBZ is already
 *   there (finished while the app was away) is reported `finished` by `enqueue()`.
 */
export interface BackgroundDownloadsPlugin {
  enqueue(job: NativeDownloadJob): Promise<NativeDownloadState>;
  cancel(options: { id: number }): Promise<void>;
  list(): Promise<{ jobs: NativeDownloadState[] }>;
  setLabels(labels: NativeDownloadLabels): Promise<void>;
  addListener(event: 'progress', listener: (state: NativeDownloadState) => void): Promise<{ remove: () => Promise<void> }>;
}

export const BackgroundDownloads = registerPlugin<BackgroundDownloadsPlugin>('BackgroundDownloads');

/** The native downloader, reduced to what the app uses; a token so tests can replace it. */
export interface NativeDownloader {
  enqueue(job: NativeDownloadJob): Promise<NativeDownloadState>;
  cancel(id: number): Promise<void>;
  setLabels(labels: NativeDownloadLabels): Promise<void>;
  onProgress(listener: (state: NativeDownloadState) => void): void;
}

/**
 * The native downloader on Android and iOS; null in the browser (which downloads in the
 * app itself). A plain object: see DOWNLOAD_KEEP_ALIVE.
 */
export const NATIVE_DOWNLOADER = new InjectionToken<NativeDownloader | null>('NATIVE_DOWNLOADER', {
  providedIn: 'root',
  factory: () =>
    Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios'
      ? {
          enqueue: (job) => BackgroundDownloads.enqueue(job),
          cancel: (id) => BackgroundDownloads.cancel({ id }),
          setLabels: (labels) => BackgroundDownloads.setLabels(labels),
          onProgress: (listener) => {
            void BackgroundDownloads.addListener('progress', listener);
          },
        }
      : null,
});

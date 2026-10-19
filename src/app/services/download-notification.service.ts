import { Injectable, Injector, computed, effect, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

import { NATIVE_DOWNLOADER, NativeDownloadLabels } from '../native/background-downloads';
import {
  APP_ACTIVE_LISTENER,
  APP_PLATFORM,
  DOWNLOAD_KEEP_ALIVE,
  PROGRESS_NOTIFICATIONS,
} from '../native/download-keep-alive';
import { DownloadService } from './download.service';

/** The download notification's id (the same as the Android service's notification). */
export const DOWNLOAD_NOTIFICATION_ID = 4210;

/** What the notification shows: how many comics are downloading, and the current one's pages. */
export interface DownloadProgress {
  comics: number;
  title: string;
  done: number;
  total: number;
}

/**
 * Shows download progress in a notification and keeps downloads going in the background.
 *
 * - Android: the native downloader's foreground service runs while comics are downloading
 *   and keeps its own notification ("Downloading 2 comics", "12 / 40 pages · title", with a
 *   progress bar), updated for every page even while the app is closed. Here it's only given
 *   the texts in the app's language, and notification permission is asked.
 * - iOS: there are no foreground services, so downloads continue only while the app is
 *   open, plus the short extra time iOS gives on leaving it. The notification is shown
 *   while the app is in the background, updated when the comic or the count changes
 *   (iOS shows every update as a new alert, so not for every page), and removed on return.
 * - Web: nothing.
 */
@Injectable({ providedIn: 'root' })
export class DownloadNotificationService {
  private readonly downloads = inject(DownloadService);
  private readonly keepAlive = inject(DOWNLOAD_KEEP_ALIVE);
  private readonly native = inject(NATIVE_DOWNLOADER);
  private readonly notifications = inject(PROGRESS_NOTIFICATIONS);
  private readonly platform = inject(APP_PLATFORM);
  private readonly listenForActive = inject(APP_ACTIVE_LISTENER);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  /** Comics waiting or downloading (failed ones aren't), or null when there's nothing to show. */
  readonly progress = computed<DownloadProgress | null>(() => {
    if (!this.downloads.folderReady()) {
      return null;
    }
    const active = this.downloads.jobs().filter((job) => job.status !== 'failed');
    if (active.length === 0) {
      return null;
    }
    const current = active.find((job) => job.status === 'downloading') ?? active[0];
    return { comics: active.length, title: current.title, done: current.downloadedPages, total: current.totalPages };
  });

  private started = false;
  private appActive = true;
  private askedPermission = false;
  private keepAliveRunning = false;
  /** What the iOS notification currently shows (null when there's none). */
  private shownKey: string | null = null;
  /** The texts last given to the native downloader (Android). */
  private labelsKey: string | null = null;
  private dirty = false;
  private applying = false;

  /** Starts following the downloads. Call once at startup. */
  init(): void {
    if (this.started || this.platform === 'web') {
      return;
    }
    this.started = true;
    this.listenForActive((active) => {
      this.appActive = active;
      this.refresh();
    });
    effect(
      () => {
        this.progress();
        this.refresh();
      },
      { injector: this.injector },
    );
    // The language changed, or its translations finished loading.
    this.transloco.events$.subscribe(() => this.refresh());
  }

  /** Applies the latest progress; updates are applied one at a time, skipping stale ones. */
  private refresh(): void {
    this.dirty = true;
    if (!this.applying) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.applying = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.apply(this.progress()).catch(() => undefined);
      }
    } finally {
      this.applying = false;
    }
  }

  private async apply(progress: DownloadProgress | null): Promise<void> {
    if (this.platform === 'android') {
      await this.applyAndroid(progress);
      return;
    }
    if (!progress) {
      if (this.keepAliveRunning) {
        this.keepAliveRunning = false;
        await this.keepAlive.stop();
      }
      await this.hideNotification();
      return;
    }
    if (!this.askedPermission) {
      // Asked when the first download starts (Android 13+ and iOS need it to show notifications).
      this.askedPermission = true;
      await this.notifications.requestPermission().catch(() => false);
    }
    const title = this.transloco.translate(progress.comics === 1 ? 'NOTIFICATION.TITLE_ONE' : 'NOTIFICATION.TITLE_OTHER', {
      count: progress.comics,
    });
    const body = this.transloco.translate('NOTIFICATION.BODY', {
      done: progress.done,
      total: progress.total,
      title: progress.title,
    });
    try {
      await this.keepAlive.update({
        title,
        body,
        done: progress.done,
        total: progress.total,
        channelName: this.transloco.translate('NOTIFICATION.CHANNEL'),
      });
      this.keepAliveRunning = true;
    } catch {
      this.keepAliveRunning = false;
    }
    if (this.platform === 'ios') {
      if (this.appActive) {
        await this.hideNotification();
      } else {
        const key = `${progress.comics}|${progress.title}`;
        if (key !== this.shownKey) {
          this.shownKey = key;
          await this.notifications.show(DOWNLOAD_NOTIFICATION_ID, title, body);
        }
      }
    }
  }

  /** The native downloader shows the notification; it needs the permission and the texts. */
  private async applyAndroid(progress: DownloadProgress | null): Promise<void> {
    if (!progress || !this.native) {
      return;
    }
    if (!this.askedPermission) {
      this.askedPermission = true;
      await this.notifications.requestPermission().catch(() => false);
    }
    const labels: NativeDownloadLabels = {
      titleOne: this.transloco.translate('NOTIFICATION.TITLE_ONE', { count: '{count}' }),
      titleOther: this.transloco.translate('NOTIFICATION.TITLE_OTHER', { count: '{count}' }),
      body: this.transloco.translate('NOTIFICATION.BODY', { done: '{done}', total: '{total}', title: '{title}' }),
      channel: this.transloco.translate('NOTIFICATION.CHANNEL'),
    };
    const key = JSON.stringify(labels);
    if (key !== this.labelsKey) {
      await this.native.setLabels(labels);
      this.labelsKey = key;
    }
  }

  private async hideNotification(): Promise<void> {
    if (this.shownKey !== null) {
      this.shownKey = null;
      await this.notifications.cancel(DOWNLOAD_NOTIFICATION_ID);
    }
  }
}

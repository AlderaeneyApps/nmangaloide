import { InjectionToken } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export interface KeepAliveProgress {
  title: string;
  body: string;
  /** Pages downloaded of the current comic, and its total (Android shows a progress bar). */
  done: number;
  total: number;
  /** Name of the notification channel (Android settings), in the app's language. */
  channelName: string;
}

/**
 * The app's own iOS plugin (DownloadKeepAlivePlugin.swift) keeping downloads running a
 * little longer in the background: it asks for extra time when the app is backgrounded;
 * the notification is posted separately (PROGRESS_NOTIFICATIONS). Android downloads
 * natively instead, in a foreground service (see background-downloads.ts).
 */
export interface DownloadKeepAlivePlugin {
  update(progress: KeepAliveProgress): Promise<void>;
  stop(): Promise<void>;
}

export const DownloadKeepAlive = registerPlugin<DownloadKeepAlivePlugin>('DownloadKeepAlive', {
  // Nothing to keep alive in a browser.
  web: { update: async () => undefined, stop: async () => undefined },
});

/**
 * The plugin; a token so tests can replace it. Wrapped in a plain object: Angular calls
 * `ngOnDestroy` on injected values that have one, and a plugin proxy appears to have every method.
 */
export const DOWNLOAD_KEEP_ALIVE = new InjectionToken<DownloadKeepAlivePlugin>('DOWNLOAD_KEEP_ALIVE', {
  providedIn: 'root',
  factory: () => ({
    update: (progress) => DownloadKeepAlive.update(progress),
    stop: () => DownloadKeepAlive.stop(),
  }),
});

/** Local Notifications, reduced to what the download notification needs; a token so tests can replace it. */
export interface ProgressNotifications {
  /** Asks for permission to show notifications (Android 13+, iOS). Resolves with whether it was granted. */
  requestPermission(): Promise<boolean>;
  /** Shows a notification, replacing the one with the same id. */
  show(id: number, title: string, body: string): Promise<void>;
  cancel(id: number): Promise<void>;
}

export const PROGRESS_NOTIFICATIONS = new InjectionToken<ProgressNotifications>('PROGRESS_NOTIFICATIONS', {
  providedIn: 'root',
  factory: () => ({
    requestPermission: async () => (await LocalNotifications.requestPermissions()).display === 'granted',
    show: async (id, title, body) => {
      await LocalNotifications.schedule({ notifications: [{ id, title, body, threadIdentifier: 'downloads' }] });
    },
    cancel: async (id) => {
      await LocalNotifications.cancel({ notifications: [{ id }] });
      await LocalNotifications.removeDeliveredNotifications({ notifications: [{ id, title: '', body: '' }] });
    },
  }),
});

/** The platform ('android', 'ios' or 'web'); a token so tests can choose. */
export const APP_PLATFORM = new InjectionToken<string>('APP_PLATFORM', {
  providedIn: 'root',
  factory: () => Capacitor.getPlatform(),
});

/** Calls `listener` when the app goes to the background (false) or comes back (true). */
export const APP_ACTIVE_LISTENER = new InjectionToken<(listener: (active: boolean) => void) => void>('APP_ACTIVE_LISTENER', {
  providedIn: 'root',
  factory: () => (listener) => {
    void App.addListener('appStateChange', ({ isActive }) => listener(isActive));
  },
});

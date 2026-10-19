import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { NATIVE_DOWNLOADER } from '../native/background-downloads';
import { APP_ACTIVE_LISTENER, APP_PLATFORM, DOWNLOAD_KEEP_ALIVE, PROGRESS_NOTIFICATIONS } from '../native/download-keep-alive';
import { getTranslocoTestingModule } from '../testing/transloco-testing';
import { DOWNLOAD_NOTIFICATION_ID, DownloadNotificationService } from './download-notification.service';
import { DownloadJob, DownloadService } from './download.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const job = (id: number, status: DownloadJob['status'], done = 0, total = 40): DownloadJob => ({
  id,
  title: `Comic ${id}`,
  totalPages: total,
  downloadedPages: done,
  status,
});

describe('DownloadNotificationService', () => {
  let jobs: ReturnType<typeof signal<DownloadJob[]>>;
  let folderReady: ReturnType<typeof signal<boolean>>;
  let keepAlive: { update: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let notifications: {
    requestPermission: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let native: { setLabels: ReturnType<typeof vi.fn> };
  let setActive: (active: boolean) => void;

  function setUp(platform: string) {
    jobs = signal<DownloadJob[]>([]);
    folderReady = signal(true);
    keepAlive = { update: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    native = { setLabels: vi.fn().mockResolvedValue(undefined) };
    notifications = {
      requestPermission: vi.fn().mockResolvedValue(true),
      show: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [
        { provide: DownloadService, useValue: { jobs, folderReady } },
        { provide: DOWNLOAD_KEEP_ALIVE, useValue: keepAlive },
        { provide: NATIVE_DOWNLOADER, useValue: platform === 'android' ? native : null },
        { provide: PROGRESS_NOTIFICATIONS, useValue: notifications },
        { provide: APP_PLATFORM, useValue: platform },
        { provide: APP_ACTIVE_LISTENER, useValue: (listener: (active: boolean) => void) => (setActive = listener) },
      ],
    });
    TestBed.inject(DownloadNotificationService).init();
  }

  /** Lets the effect run and the (asynchronous) updates finish. */
  async function settle() {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  describe('on Android', () => {
    beforeEach(() => setUp('android'));

    it('leaves the notification to the native downloader, giving it the texts once downloads start', async () => {
      await settle();
      expect(native.setLabels).not.toHaveBeenCalled();

      jobs.set([job(1, 'downloading', 3), job(2, 'queued')]);
      await settle();
      expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
      expect(native.setLabels).toHaveBeenCalledWith({
        titleOne: 'Downloading 1 comic',
        titleOther: 'Downloading {count} comics',
        body: '{done} / {total} pages · {title}',
        channel: 'Downloads',
      });
      // The native side updates the notification for every page, even with the app closed.
      jobs.set([job(1, 'downloading', 4), job(2, 'queued')]);
      await settle();
      expect(native.setLabels).toHaveBeenCalledTimes(1);
      expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
      expect(keepAlive.update).not.toHaveBeenCalled();
      expect(keepAlive.stop).not.toHaveBeenCalled();
      expect(notifications.show).not.toHaveBeenCalled();
    });

    it('does nothing while downloads wait for a folder to be chosen', async () => {
      folderReady.set(false);
      jobs.set([job(1, 'queued')]);
      await settle();
      expect(native.setLabels).not.toHaveBeenCalled();
      expect(notifications.requestPermission).not.toHaveBeenCalled();
    });

    it('uses the app language, and follows when it changes', async () => {
      const transloco = TestBed.inject(TranslocoService);
      transloco.setActiveLang('es');
      jobs.set([job(1, 'downloading', 3)]);
      await settle();
      expect(native.setLabels).toHaveBeenLastCalledWith({
        titleOne: 'Descargando 1 cómic',
        titleOther: 'Descargando {count} cómics',
        body: '{done} / {total} páginas · {title}',
        channel: 'Descargas',
      });

      transloco.setActiveLang('en');
      await settle();
      expect(native.setLabels).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'Downloads' }));
    });
  });

  describe('on iOS', () => {
    beforeEach(() => setUp('ios'));

    it('shows the notification only while the app is in the background, updated when the comic changes', async () => {
      jobs.set([job(1, 'downloading', 3), job(2, 'queued')]);
      await settle();
      // In the foreground: extra background time is requested, but no notification.
      expect(keepAlive.update).toHaveBeenCalled();
      expect(notifications.show).not.toHaveBeenCalled();

      setActive(false);
      await settle();
      expect(notifications.show).toHaveBeenCalledWith(DOWNLOAD_NOTIFICATION_ID, 'Downloading 2 comics', '3 / 40 pages · Comic 1');

      // Pages alone don't re-alert…
      jobs.set([job(1, 'downloading', 4), job(2, 'queued')]);
      await settle();
      expect(notifications.show).toHaveBeenCalledTimes(1);
      // …the next comic does.
      jobs.set([job(2, 'downloading', 0)]);
      await settle();
      expect(notifications.show).toHaveBeenLastCalledWith(DOWNLOAD_NOTIFICATION_ID, 'Downloading 1 comic', '0 / 40 pages · Comic 2');

      setActive(true);
      await settle();
      expect(notifications.cancel).toHaveBeenCalledWith(DOWNLOAD_NOTIFICATION_ID);
    });

    it('removes the notification and stops when the downloads finish', async () => {
      jobs.set([job(1, 'downloading', 39)]);
      setActive(false);
      await settle();
      expect(notifications.show).toHaveBeenCalledTimes(1);

      jobs.set([]);
      await settle();
      expect(notifications.cancel).toHaveBeenCalledWith(DOWNLOAD_NOTIFICATION_ID);
      expect(keepAlive.stop).toHaveBeenCalled();
    });
  });

  it('does nothing in the browser', async () => {
    setUp('web');
    jobs.set([job(1, 'downloading', 3)]);
    await settle();
    expect(keepAlive.update).not.toHaveBeenCalled();
    expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
});

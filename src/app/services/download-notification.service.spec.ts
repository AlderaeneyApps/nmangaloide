import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

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
  let setActive: (active: boolean) => void;

  function setUp(platform: string) {
    jobs = signal<DownloadJob[]>([]);
    folderReady = signal(true);
    keepAlive = { update: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
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

    it('starts the background service with the count of comics and the current comic’s pages', async () => {
      await settle();
      expect(keepAlive.update).not.toHaveBeenCalled();

      jobs.set([job(1, 'downloading', 3), job(2, 'queued')]);
      await settle();
      expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
      expect(keepAlive.update).toHaveBeenLastCalledWith({
        title: 'Downloading 2 comics',
        body: '3 / 40 pages · Comic 1',
        done: 3,
        total: 40,
        channelName: 'Downloads',
      });
    });

    it('updates the notification for every page', async () => {
      jobs.set([job(1, 'downloading', 3)]);
      await settle();
      jobs.set([job(1, 'downloading', 4)]);
      await settle();
      jobs.set([job(1, 'downloading', 5)]);
      await settle();
      expect(keepAlive.update.mock.calls.map(([progress]) => progress.body)).toEqual([
        '3 / 40 pages · Comic 1',
        '4 / 40 pages · Comic 1',
        '5 / 40 pages · Comic 1',
      ]);
      expect(keepAlive.update).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Downloading 1 comic' }));
      // Permission is asked only once.
      expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('stops when nothing is left to download, failed downloads included', async () => {
      jobs.set([job(1, 'downloading', 3), job(2, 'failed')]);
      await settle();
      expect(keepAlive.update).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Downloading 1 comic' }));

      jobs.set([job(2, 'failed')]);
      await settle();
      expect(keepAlive.stop).toHaveBeenCalledTimes(1);

      jobs.set([]);
      await settle();
      expect(keepAlive.stop).toHaveBeenCalledTimes(1);
    });

    it('shows nothing while downloads wait for a folder to be chosen', async () => {
      folderReady.set(false);
      jobs.set([job(1, 'queued')]);
      await settle();
      expect(keepAlive.update).not.toHaveBeenCalled();

      folderReady.set(true);
      await settle();
      expect(keepAlive.update).toHaveBeenCalledTimes(1);
    });

    it('tries again when the app is opened if Android refused to start the service in the background', async () => {
      keepAlive.update.mockRejectedValueOnce(Object.assign(new Error('not allowed'), { code: 'NOT_ALLOWED' }));
      jobs.set([job(1, 'downloading', 3)]);
      await settle();
      expect(keepAlive.update).toHaveBeenCalledTimes(1);

      setActive(true);
      await settle();
      expect(keepAlive.update).toHaveBeenCalledTimes(2);
      // It wasn't running, so there's nothing to stop yet; once running, finishing stops it.
      jobs.set([]);
      await settle();
      expect(keepAlive.stop).toHaveBeenCalledTimes(1);
    });

    it('uses the app language', async () => {
      TestBed.inject(TranslocoService).setActiveLang('es');
      jobs.set([job(1, 'downloading', 3), job(2, 'queued')]);
      await settle();
      expect(keepAlive.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Descargando 2 cómics', body: '3 / 40 páginas · Comic 1', channelName: 'Descargas' }),
      );
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

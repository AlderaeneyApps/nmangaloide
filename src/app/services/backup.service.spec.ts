import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { CACHE_FILES, FILE_SAVER } from '../native/file-saver';
import { DatabaseService } from '../sql-services/database.service';
import { BackupService, backupFileName } from './backup.service';
import { AppSettingsService } from './app-settings.service';
import { DownloadService } from './download.service';
import { SavedGalleriesService } from './saved-galleries.service';
import { TagPreferencesService } from './tag-preferences.service';

describe('BackupService', () => {
  let database: { exportJson: ReturnType<typeof vi.fn>; importJson: ReturnType<typeof vi.fn> };
  let tags: { reload: ReturnType<typeof vi.fn> };
  let settings: { reload: ReturnType<typeof vi.fn> };
  let savedGalleries: { reload: ReturnType<typeof vi.fn> };
  let downloads: { resetAfterImport: ReturnType<typeof vi.fn> };
  let saveAs: ReturnType<typeof vi.fn>;
  let cacheFiles: { write: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let service: BackupService;

  beforeEach(() => {
    database = {
      exportJson: vi.fn().mockResolvedValue('{"version":1}'),
      importJson: vi.fn().mockResolvedValue(undefined),
    };
    tags = { reload: vi.fn().mockResolvedValue(undefined) };
    settings = { reload: vi.fn().mockResolvedValue(undefined) };
    savedGalleries = { reload: vi.fn().mockResolvedValue(undefined) };
    downloads = { resetAfterImport: vi.fn().mockResolvedValue(undefined) };
    saveAs = vi.fn().mockResolvedValue({ uri: 'content://picked/backup.json' });
    cacheFiles = {
      write: vi.fn().mockResolvedValue('file:///data/user/0/com.alderaeney/cache/nmangaloide-backup-2026-10-18.json'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: database },
        { provide: TagPreferencesService, useValue: tags },
        { provide: AppSettingsService, useValue: settings },
        { provide: SavedGalleriesService, useValue: savedGalleries },
        { provide: DownloadService, useValue: downloads },
        { provide: FILE_SAVER, useValue: { saveAs } },
        { provide: CACHE_FILES, useValue: cacheFiles },
      ],
    });
    service = TestBed.inject(BackupService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('names backups after the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('nmangaloide-backup-2026-01-05.json');
  });

  it('downloads the export in the browser', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:backup');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });

    const name = await service.exportToFile('device', new Date(2026, 9, 18));

    expect(name).toBe('nmangaloide-backup-2026-10-18.json');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"version":1}');
    expect(clicked!.download).toBe(name);
    expect(clicked!.href).toBe('blob:backup');
  });

  it('on a phone, saves the export where the user picks, through a cache file', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const name = await service.exportToFile('device', new Date(2026, 9, 18));

    expect(cacheFiles.write).toHaveBeenCalledWith('nmangaloide-backup-2026-10-18.json', '{"version":1}');
    // Only the file's address crosses to the native side, never the contents.
    expect(saveAs).toHaveBeenCalledWith({
      fileName: 'nmangaloide-backup-2026-10-18.json',
      sourceUri: 'file:///data/user/0/com.alderaeney/cache/nmangaloide-backup-2026-10-18.json',
      mimeType: 'application/json',
    });
    expect(JSON.stringify(saveAs.mock.calls[0][0])).not.toContain('version');
    expect(cacheFiles.remove).toHaveBeenCalledWith('nmangaloide-backup-2026-10-18.json');
    expect(name).toBe('nmangaloide-backup-2026-10-18.json');
  });

  it('passes on a cancelled save picker', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    saveAs.mockRejectedValue(Object.assign(new Error('Save cancelled'), { code: 'CANCELLED' }));
    await expect(service.exportToFile('device')).rejects.toMatchObject({ code: 'CANCELLED' });
    // The cache copy is cleaned up either way.
    expect(cacheFiles.remove).toHaveBeenCalled();
  });

  it('imports a file and reloads the saved tags, settings and favorites', async () => {
    await service.importFromFile(new Blob(['{"tables":[]}'], { type: 'application/json' }));
    expect(database.importJson).toHaveBeenCalledWith('{"tables":[]}');
    expect(tags.reload).toHaveBeenCalled();
    expect(settings.reload).toHaveBeenCalled();
    expect(savedGalleries.reload).toHaveBeenCalled();
    // Backups carry no downloaded pages, so imported downloads are cleared first.
    expect(downloads.resetAfterImport).toHaveBeenCalled();
  });

  it('does not reload when the import fails', async () => {
    database.importJson.mockRejectedValue(new Error('bad file'));
    await expect(service.importFromFile(new Blob(['x']))).rejects.toThrow('bad file');
    expect(tags.reload).not.toHaveBeenCalled();
  });
});

import { TestBed } from '@angular/core/testing';

import { DatabaseService } from '../sql-services/database.service';
import { BackupService, backupFileName } from './backup.service';
import { TagPreferencesService } from './tag-preferences.service';

describe('BackupService', () => {
  let database: { exportJson: ReturnType<typeof vi.fn>; importJson: ReturnType<typeof vi.fn> };
  let tags: { reload: ReturnType<typeof vi.fn> };
  let service: BackupService;

  beforeEach(() => {
    database = {
      exportJson: vi.fn().mockResolvedValue('{"version":1}'),
      importJson: vi.fn().mockResolvedValue(undefined),
    };
    tags = { reload: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: database },
        { provide: TagPreferencesService, useValue: tags },
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

    const name = await service.exportToFile(new Date(2026, 9, 18));

    expect(name).toBe('nmangaloide-backup-2026-10-18.json');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"version":1}');
    expect(clicked!.download).toBe(name);
    expect(clicked!.href).toBe('blob:backup');
  });

  it('imports a file and reloads the saved tags', async () => {
    await service.importFromFile(new Blob(['{"tables":[]}'], { type: 'application/json' }));
    expect(database.importJson).toHaveBeenCalledWith('{"tables":[]}');
    expect(tags.reload).toHaveBeenCalled();
  });

  it('does not reload when the import fails', async () => {
    database.importJson.mockRejectedValue(new Error('bad file'));
    await expect(service.importFromFile(new Blob(['x']))).rejects.toThrow('bad file');
    expect(tags.reload).not.toHaveBeenCalled();
  });
});

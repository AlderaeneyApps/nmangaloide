import { TestBed } from '@angular/core/testing';

import { DB_NMANGALOIDE } from '../constants';
import { NMANGALOIDE_DB_VERSION, NMANGALOIDE_UPGRADES } from '../sql-upgrades/nmangaloide.upgrade.statements';
import { DatabaseService, InvalidBackupError, NewerBackupError } from './database.service';
import { DbnameVersionService } from './dbname-version.service';
import { SQLiteService } from './sqlite.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const BACKUP = {
  database: 'nmangaloide',
  version: 1,
  encrypted: false,
  mode: 'full',
  tables: [{ name: 'tag_preferences', schema: [], values: [[1, 'yuri', 'yuri', 'tag', 5, 'enabled', 0]] }],
};

describe('DatabaseService', () => {
  let sqlite: {
    platform: string;
    addUpgradeStatement: ReturnType<typeof vi.fn>;
    encryptionOptions: ReturnType<typeof vi.fn>;
    openDatabase: ReturnType<typeof vi.fn>;
    saveToStore: ReturnType<typeof vi.fn>;
    closeConnection: ReturnType<typeof vi.fn>;
    isJsonValid: ReturnType<typeof vi.fn>;
    importFromJson: ReturnType<typeof vi.fn>;
  };
  let db: { query: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn>; exportToJson: ReturnType<typeof vi.fn> };
  let service: DatabaseService;

  beforeEach(() => {
    db = {
      query: vi.fn().mockResolvedValue({ values: [{ id: 1 }] }),
      run: vi.fn().mockResolvedValue({}),
      exportToJson: vi.fn().mockResolvedValue({ export: BACKUP }),
    };
    sqlite = {
      platform: 'android',
      addUpgradeStatement: vi.fn().mockResolvedValue(undefined),
      encryptionOptions: vi.fn().mockResolvedValue({ encrypted: true, mode: 'secret' }),
      openDatabase: vi.fn().mockResolvedValue(db),
      saveToStore: vi.fn().mockResolvedValue(undefined),
      closeConnection: vi.fn().mockResolvedValue(undefined),
      isJsonValid: vi.fn().mockResolvedValue(true),
      importFromJson: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [DatabaseService, DbnameVersionService, { provide: SQLiteService, useValue: sqlite }],
    });
    service = TestBed.inject(DatabaseService);
  });

  it('applies the upgrades and opens the database with the encryption settings', async () => {
    await service.open();

    expect(sqlite.addUpgradeStatement).toHaveBeenCalledWith({ database: DB_NMANGALOIDE, upgrade: NMANGALOIDE_UPGRADES });
    expect(sqlite.openDatabase).toHaveBeenCalledWith(DB_NMANGALOIDE, true, 'secret', NMANGALOIDE_DB_VERSION, false);
    expect(TestBed.inject(DbnameVersionService).getVersion(DB_NMANGALOIDE)).toBe(NMANGALOIDE_DB_VERSION);
  });

  it('waits for the database before running queries', async () => {
    const rows = service.query('SELECT 1');
    await service.open();
    await expect(rows).resolves.toEqual([{ id: 1 }]);
  });

  it('saves to the browser store after writes on the web only', async () => {
    await service.open();
    await service.run('DELETE FROM x');
    expect(sqlite.saveToStore).not.toHaveBeenCalled();

    sqlite.platform = 'web';
    await service.run('DELETE FROM x');
    expect(sqlite.saveToStore).toHaveBeenCalledWith(DB_NMANGALOIDE);
  });

  it('rejects queries when opening fails', async () => {
    sqlite.openDatabase.mockRejectedValue(new Error('wrong key'));
    await expect(service.open()).rejects.toThrow('wrong key');
    await expect(service.query('SELECT 1')).rejects.toThrow('wrong key');
  });

  describe('backups', () => {
    beforeEach(() => service.open());

    it('exports the database as JSON', async () => {
      const json = await service.exportJson();
      expect(db.exportToJson).toHaveBeenCalledWith('full');
      expect(JSON.parse(json)).toEqual(BACKUP);
    });

    it('imports a backup over the current database and reopens it', async () => {
      const reopened = { ...db };
      sqlite.openDatabase.mockResolvedValue(reopened);

      await service.importJson(JSON.stringify({ ...BACKUP, database: 'other-name' }));

      expect(sqlite.closeConnection).toHaveBeenCalledWith(DB_NMANGALOIDE, false);
      const imported = JSON.parse(sqlite.importFromJson.mock.calls[0][0]);
      expect(imported).toMatchObject({ database: DB_NMANGALOIDE, encrypted: true, mode: 'full', overwrite: true });
      expect(imported.tables).toEqual(BACKUP.tables);
      expect(sqlite.openDatabase).toHaveBeenCalledTimes(2);
      expect(await service.connection()).toBe(reopened);
    });

    it('rejects files that are not backups without touching the database', async () => {
      await expect(service.importJson('not json')).rejects.toBeInstanceOf(InvalidBackupError);
      await expect(service.importJson('{"hello": 1}')).rejects.toBeInstanceOf(InvalidBackupError);
      sqlite.isJsonValid.mockResolvedValue(false);
      await expect(service.importJson(JSON.stringify(BACKUP))).rejects.toBeInstanceOf(InvalidBackupError);
      expect(sqlite.closeConnection).not.toHaveBeenCalled();
    });

    it('rejects backups from a newer app version', async () => {
      const error = await service.importJson(JSON.stringify({ ...BACKUP, version: 99 })).catch((e) => e);
      expect(error).toBeInstanceOf(NewerBackupError);
      expect(error.backupVersion).toBe(99);
      expect(sqlite.closeConnection).not.toHaveBeenCalled();
    });

    it('reopens the database even when the import fails', async () => {
      sqlite.importFromJson.mockRejectedValue(new Error('import failed'));
      await expect(service.importJson(JSON.stringify(BACKUP))).rejects.toThrow('import failed');
      expect(sqlite.openDatabase).toHaveBeenCalledTimes(2);
      await expect(service.query('SELECT 1')).resolves.toEqual([{ id: 1 }]);
    });

    it('makes queries wait until the imported database is open', async () => {
      let finishImport!: () => void;
      sqlite.importFromJson.mockReturnValue(new Promise<void>((resolve) => (finishImport = resolve)));
      const importing = service.importJson(JSON.stringify(BACKUP));
      await new Promise((resolve) => setTimeout(resolve));

      const rows = service.query('SELECT 1');
      const settled = vi.fn();
      void rows.then(settled);
      await new Promise((resolve) => setTimeout(resolve));
      expect(settled).not.toHaveBeenCalled();

      finishImport();
      await importing;
      await expect(rows).resolves.toEqual([{ id: 1 }]);
    });
  });
});

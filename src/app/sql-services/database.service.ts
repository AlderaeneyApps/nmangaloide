import { Injectable, inject } from '@angular/core';
import { JsonSQLite, SQLiteDBConnection } from '@capacitor-community/sqlite';

import { DB_NMANGALOIDE } from '../constants';
import { NMANGALOIDE_DB_VERSION, NMANGALOIDE_UPGRADES } from '../sql-upgrades/nmangaloide.upgrade.statements';
import { DbnameVersionService } from './dbname-version.service';
import { SQLiteService } from './sqlite.service';

/**
 * Owns the app's single connection to the nmangaloide database. `open()` is
 * called once at startup by InitializeAppService; everything else waits for it
 * through `connection()`.
 */
@Injectable()
export class DatabaseService {
  private readonly sqlite = inject(SQLiteService);
  private readonly versions = inject(DbnameVersionService);

  private db: SQLiteDBConnection | null = null;
  private resolveReady!: (db: SQLiteDBConnection) => void;
  private rejectReady!: (error: unknown) => void;
  private ready = new Promise<SQLiteDBConnection>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  constructor() {
    // Avoid "unhandled rejection" noise if nothing is waiting when opening fails.
    this.ready.catch(() => undefined);
  }

  /** Applies pending schema upgrades and opens the database (encrypted on Android/iOS). */
  async open(): Promise<void> {
    try {
      this.resolveReady(await this.connect());
    } catch (error) {
      this.rejectReady(error);
      throw error;
    }
  }

  /**
   * The whole database as a JSON backup, in the SQLite plugin's export format.
   * The backup itself isn't encrypted, so it can be imported on any device.
   */
  async exportJson(): Promise<string> {
    const db = await this.connection();
    const { export: data } = await db.exportToJson('full');
    if (!data) {
      throw new Error('The database could not be exported.');
    }
    return JSON.stringify(data, null, 2);
  }

  /**
   * Replaces the whole database with a backup made by `exportJson()`.
   * Backups from older schema versions are upgraded when the database reopens.
   */
  async importJson(json: string): Promise<void> {
    const backup = parseBackup(json);
    const { encrypted } = await this.sqlite.encryptionOptions(DB_NMANGALOIDE);
    const prepared = JSON.stringify({ ...backup, database: DB_NMANGALOIDE, encrypted, mode: 'full', overwrite: true });
    if (!(await this.sqlite.isJsonValid(prepared))) {
      throw new InvalidBackupError();
    }

    // Queries wait for the reopened database instead of using the closed one.
    let importError: unknown = null;
    const reopened = (async () => {
      await this.connection().catch(() => undefined);
      await this.sqlite.closeConnection(DB_NMANGALOIDE, false);
      this.db = null;
      try {
        await this.sqlite.importFromJson(prepared);
      } catch (error) {
        importError = error;
      }
      // Reopen even if the import failed, so the app keeps working with what's there.
      this.db = await this.connect();
      return this.db;
    })();
    this.ready = reopened;
    this.ready.catch(() => undefined);
    await reopened;
    if (importError) {
      throw importError;
    }
  }

  /** The open connection, once `open()` has finished. Rejects if opening failed. */
  connection(): Promise<SQLiteDBConnection> {
    return this.ready;
  }

  async query<T>(statement: string, values: unknown[] = []): Promise<T[]> {
    const db = await this.connection();
    const result = await db.query(statement, values);
    return (result.values ?? []) as T[];
  }

  /** Runs a write and, on the web, saves the in-memory database to IndexedDB. */
  async run(statement: string, values: unknown[] = []): Promise<void> {
    const db = await this.connection();
    await db.run(statement, values);
    if (this.sqlite.platform === 'web') {
      await this.sqlite.saveToStore(DB_NMANGALOIDE);
    }
  }

  private async connect(): Promise<SQLiteDBConnection> {
    await this.sqlite.addUpgradeStatement({ database: DB_NMANGALOIDE, upgrade: NMANGALOIDE_UPGRADES });
    const { encrypted, mode } = await this.sqlite.encryptionOptions(DB_NMANGALOIDE);
    const db = await this.sqlite.openDatabase(DB_NMANGALOIDE, encrypted, mode, NMANGALOIDE_DB_VERSION, false);
    this.versions.set(DB_NMANGALOIDE, NMANGALOIDE_DB_VERSION);
    if (this.sqlite.platform === 'web') {
      await this.sqlite.saveToStore(DB_NMANGALOIDE);
    }
    return db;
  }
}

/** The file isn't a backup this app can read. */
export class InvalidBackupError extends Error {
  constructor(message = 'Not a valid nMangaloide backup.') {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

/** The backup comes from a newer version of the app, with a schema this one doesn't know. */
export class NewerBackupError extends Error {
  constructor(readonly backupVersion: number) {
    super(`The backup uses database version ${backupVersion}, newer than this app's ${NMANGALOIDE_DB_VERSION}.`);
    this.name = 'NewerBackupError';
  }
}

function parseBackup(json: string): JsonSQLite {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InvalidBackupError();
  }
  const backup = data as Partial<JsonSQLite> | null;
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.tables) || typeof backup.version !== 'number') {
    throw new InvalidBackupError();
  }
  if (backup.version > NMANGALOIDE_DB_VERSION) {
    throw new NewerBackupError(backup.version);
  }
  return backup as JsonSQLite;
}

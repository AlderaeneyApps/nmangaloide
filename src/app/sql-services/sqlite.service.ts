import { Injectable } from '@angular/core';

import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  CapacitorSQLitePlugin,
  capSQLiteUpgradeOptions,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';

export interface EncryptionOptions {
  encrypted: boolean;
  /** `no-encryption`, `secret` (open/create encrypted) or `encryption` (encrypt an existing plain database). */
  mode: string;
}

/** A random 256-bit passphrase, hex encoded. */
export function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Thin wrapper around the Capacitor SQLite plugin, so the database code can be tested with a fake. */
@Injectable()
export class SQLiteService {
  sqliteConnection!: SQLiteConnection;
  isService = false;
  /** 'android', 'ios' or 'web'; set by `initializePlugin()`. */
  platform!: string;
  sqlitePlugin!: CapacitorSQLitePlugin;
  native = false;

  async initializePlugin(): Promise<boolean> {
    this.platform = Capacitor.getPlatform();
    this.native = this.platform === 'ios' || this.platform === 'android';
    this.sqlitePlugin = CapacitorSQLite;
    this.sqliteConnection = new SQLiteConnection(this.sqlitePlugin);
    this.isService = true;
    return true;
  }

  /** The web build keeps the database in IndexedDB, through the <jeep-sqlite> element. */
  async initWebStore(): Promise<void> {
    try {
      await this.sqliteConnection.initWebStore();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`initWebStore: ${message}`, { cause: error });
    }
  }

  async openDatabase(
    dbName: string,
    encrypted: boolean,
    mode: string,
    version: number,
    readonly: boolean,
  ): Promise<SQLiteDBConnection> {
    const consistent = (await this.sqliteConnection.checkConnectionsConsistency()).result;
    const connected = (await this.sqliteConnection.isConnection(dbName, readonly)).result;
    const db =
      consistent && connected
        ? await this.sqliteConnection.retrieveConnection(dbName, readonly)
        : await this.sqliteConnection.createConnection(dbName, encrypted, mode, version, readonly);
    await db.open();
    return db;
  }

  /**
   * How to open `dbName`. On Android/iOS with encryption enabled in
   * capacitor.config.ts, databases are encrypted with SQLCipher: a random
   * passphrase is created on first use and kept by the plugin in the iOS
   * Keychain / Android encrypted storage, and an existing unencrypted database
   * is encrypted in place. The web build has no encryption support.
   */
  async encryptionOptions(dbName: string): Promise<EncryptionOptions> {
    if (!this.native || !(await this.sqliteConnection.isInConfigEncryption()).result) {
      return { encrypted: false, mode: 'no-encryption' };
    }
    if (!(await this.sqliteConnection.isSecretStored()).result) {
      await this.sqliteConnection.setEncryptionSecret(generatePassphrase());
    }
    const exists = (await this.sqliteConnection.isDatabase(dbName)).result;
    if (exists && !(await this.sqliteConnection.isDatabaseEncrypted(dbName)).result) {
      return { encrypted: true, mode: 'encryption' };
    }
    return { encrypted: true, mode: 'secret' };
  }

  retrieveConnection(dbName: string, readonly: boolean): Promise<SQLiteDBConnection> {
    return this.sqliteConnection.retrieveConnection(dbName, readonly);
  }

  closeConnection(database: string, readonly = false): Promise<void> {
    return this.sqliteConnection.closeConnection(database, readonly);
  }

  addUpgradeStatement(options: capSQLiteUpgradeOptions): Promise<void> {
    return this.sqlitePlugin.addUpgradeStatement(options);
  }

  saveToStore(database: string): Promise<void> {
    return this.sqliteConnection.saveToStore(database);
  }

  async isJsonValid(json: string): Promise<boolean> {
    return (await this.sqliteConnection.isJsonValid(json)).result ?? false;
  }

  async importFromJson(json: string): Promise<void> {
    await this.sqliteConnection.importFromJson(json);
  }
}

import { Injectable } from '@angular/core';

import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  CapacitorSQLitePlugin,
  capSQLiteUpgradeOptions,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { DB_NMANGALOIDE } from '../constants';

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


@Injectable()
export class SQLiteService {
  sqliteConnection!: SQLiteConnection;
  isService: boolean = false;
  platform!: string;
  sqlitePlugin!: CapacitorSQLitePlugin;
  native: boolean = false;

  constructor() {}

  /**
   * Plugin Initialization
   */
  async initializePlugin(): Promise<boolean> {
    this.platform = Capacitor.getPlatform();
    if (this.platform === 'ios' || this.platform === 'android') this.native = true;
    this.sqlitePlugin = CapacitorSQLite;
    this.sqliteConnection = new SQLiteConnection(this.sqlitePlugin);
    this.isService = true;
    return true;
  }

  async initWebStore(): Promise<void> {
    try {
      await this.sqliteConnection.initWebStore();
    } catch (err: any) {
      const msg = err.message ? err.message : err;
      return Promise.reject(`initWebStore: ${msg}`);
    }
  }

  async openDatabase(
    dbName: string,
    encrypted: boolean,
    mode: string,
    version: number,
    readonly: boolean,
  ): Promise<SQLiteDBConnection> {
    let db: SQLiteDBConnection;
    const retCC = (await this.sqliteConnection.checkConnectionsConsistency()).result;
    let isConn = (await this.sqliteConnection.isConnection(dbName, readonly)).result;
    if (retCC && isConn) {
      db = await this.sqliteConnection.retrieveConnection(dbName, readonly);
    } else {
      db = await this.sqliteConnection.createConnection(dbName, encrypted, mode, version, readonly);
    }
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

  async retrieveConnection(dbName: string, readonly: boolean): Promise<SQLiteDBConnection> {
    return await this.sqliteConnection.retrieveConnection(dbName, readonly);
  }

  async closeConnection(database: string, readonly?: boolean): Promise<void> {
    const readOnly = readonly ? readonly : false;
    return await this.sqliteConnection.closeConnection(database, readOnly);
  }

  async addUpgradeStatement(options: capSQLiteUpgradeOptions): Promise<void> {
    await this.sqlitePlugin.addUpgradeStatement(options);
    return;
  }

  async saveToStore(database: string): Promise<void> {
    return await this.sqliteConnection.saveToStore(database);
  }

  async isJsonValid(json: string): Promise<boolean> {
    return (await this.sqliteConnection.isJsonValid(json)).result ?? false;
  }

  async importFromJson(json: string): Promise<void> {
    await this.sqliteConnection.importFromJson(json);
  }
}

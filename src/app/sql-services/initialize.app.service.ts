import { Injectable, inject } from '@angular/core';
import { Toast } from '@capacitor/toast';

import { DB_NMANGALOIDE } from '../constants';
import { DatabaseService } from './database.service';
import { SQLiteService } from './sqlite.service';

/** Starts the SQLite plugin and opens the app's database; run once as an app initializer. */
@Injectable()
export class InitializeAppService {
  private readonly sqliteService = inject(SQLiteService);
  private readonly databaseService = inject(DatabaseService);

  isAppInit = false;
  platform = '';

  /**
   * Never rejects: a failure is shown to the user and the app starts anyway, with every
   * database read failing (pages show their error state) instead of waiting forever.
   */
  async initializeApp(): Promise<void> {
    try {
      await this.sqliteService.initializePlugin();
      this.platform = this.sqliteService.platform;
      if (this.platform === 'web') {
        await this.sqliteService.initWebStore();
      }
      // Create or upgrade the nmangaloide database and open the shared connection.
      await this.databaseService.open();
      if (this.platform === 'web') {
        await this.sqliteService.saveToStore(DB_NMANGALOIDE);
      }
      this.isAppInit = true;
    } catch (error) {
      // Nothing opened the database: let whatever waits for it fail now.
      this.databaseService.fail(error);
      console.error(`initializeAppError: ${error}`);
      await Toast.show({ text: `initializeAppError: ${error}`, duration: 'long' }).catch(() => undefined);
    }
  }
}

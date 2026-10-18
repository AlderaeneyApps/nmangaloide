import { inject, Injectable } from "@angular/core";
import { SQLiteService } from "./sqlite.service";
import { Toast } from '@capacitor/toast';
import { DB_NMANGALOIDE } from "../constants";
import { DatabaseService } from "./database.service";

@Injectable()
export class InitializeAppService {
  isAppInit: boolean = false;
  platform!: string;

  private sqliteService: SQLiteService = inject(SQLiteService);
  private databaseService: DatabaseService = inject(DatabaseService);

  async initializeApp() {
    await this.sqliteService.initializePlugin().then(async () => {
      this.platform = this.sqliteService.platform;
      try {
        if (this.sqliteService.platform === 'web') {
          await this.sqliteService.initWebStore();
        }
        // Create or upgrade the nmangaloide database and open the shared connection
        await this.databaseService.open();

        if (this.sqliteService.platform === 'web') {
          await this.sqliteService.saveToStore(DB_NMANGALOIDE);
        }

        this.isAppInit = true;
      } catch (error) {
        console.error(`initializeAppError: ${error}`);
        await Toast.show({
          text: `initializeAppError: ${error}`,
          duration: 'long',
        });
      }
    });
  }
}

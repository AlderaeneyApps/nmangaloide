import { inject, Injectable } from "@angular/core";
import { SQLiteService } from "./sqlite.service";
import { Toast } from '@capacitor/toast';

@Injectable()
export class InitializeAppService {
  isAppInit: boolean = false;
  platform!: string;

  private sqliteService: SQLiteService = inject(SQLiteService);

  async initializeApp() {
    await this.sqliteService.initializePlugin().then(async () => {
      this.platform = this.sqliteService.platform;
      try {
        if (this.sqliteService.platform === 'web') {
          await this.sqliteService.initWebStore();
        }
        // Initialize the myuserdb database

        // Here Initialize MOCK_DATA if required

        // Initialize whatever database and/or MOCK_DATA you like

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

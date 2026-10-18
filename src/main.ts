import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { defineCustomElements as defineJeepSqlite } from 'jeep-sqlite/loader';
import { provideTransloco } from '@jsverse/transloco';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { nhentaiInterceptor, provideNhentaiApi } from './app/api';
import { AVAILABLE_LANGS, DEFAULT_LANG, TranslocoHttpLoader } from './app/transloco-loader';
import { DatabaseService } from './app/sql-services/database.service';
import { DbnameVersionService } from './app/sql-services/dbname-version.service';
import { InitializeAppService } from './app/sql-services/initialize.app.service';
import { SQLiteService } from './app/sql-services/sqlite.service';

/** On the web, SQLite runs in the <jeep-sqlite> element, which must exist before the plugin starts. */
async function setUpWebSqlite(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web') {
    return;
  }
  defineJeepSqlite(window);
  document.body.appendChild(document.createElement('jeep-sqlite'));
  await customElements.whenDefined('jeep-sqlite');
}


setUpWebSqlite()
  .then(() =>
    bootstrapApplication(AppComponent, {
      providers: [
        { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
        provideIonicAngular(),
        provideRouter(
          routes,
          withPreloading(PreloadAllModules),
          withComponentInputBinding(),
        ),
        // fetch: on Android/iOS, CapacitorHttp routes it through the native HTTP stack (see capacitor.config.ts).
        provideHttpClient(withFetch(), withInterceptors([nhentaiInterceptor])),
        provideNhentaiApi(),
        SQLiteService,
        DbnameVersionService,
        DatabaseService,
        InitializeAppService,
        provideAppInitializer(() => inject(InitializeAppService).initializeApp()),
        provideTransloco({
          config: {
            availableLangs: AVAILABLE_LANGS,
            defaultLang: DEFAULT_LANG,
            fallbackLang: DEFAULT_LANG,
            reRenderOnLangChange: true,
            prodMode: !isDevMode(),
          },
          loader: TranslocoHttpLoader,
        }),
      ],
    }),
  )
  .catch((error) => console.error(error));

import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { nhentaiInterceptor, provideNhentaiApi } from './app/api';
import { AVAILABLE_LANGS, DEFAULT_LANG, TranslocoHttpLoader } from './app/transloco-loader';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withComponentInputBinding(),
    ),
    provideHttpClient(withInterceptors([nhentaiInterceptor])),
    provideNhentaiApi(),
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
});

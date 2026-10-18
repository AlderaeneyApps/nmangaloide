import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';

/** Languages with a translation file in `src/assets/i18n/`. */
export const AVAILABLE_LANGS = ['en', 'es', 'ca', 'fr', 'de'];
export const DEFAULT_LANG = 'en';

@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`/assets/i18n/${lang}.json`);
  }
}

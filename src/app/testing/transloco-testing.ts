import { TranslocoTestingModule, TranslocoTestingOptions } from '@jsverse/transloco';

import en from '../../assets/i18n/en.json';
import es from '../../assets/i18n/es.json';
import ja from '../../assets/i18n/ja.json';
import zhHans from '../../assets/i18n/zh-Hans.json';
import zhHant from '../../assets/i18n/zh-Hant.json';
import { AVAILABLE_LANGS, DEFAULT_LANG } from '../transloco-loader';

/** Transloco set up with the real English, Spanish, Japanese and Chinese files, loaded synchronously. */
export function getTranslocoTestingModule(options: TranslocoTestingOptions = {}) {
  return TranslocoTestingModule.forRoot({
    langs: { en, es, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant },
    translocoConfig: {
      availableLangs: AVAILABLE_LANGS,
      defaultLang: DEFAULT_LANG,
      // Same as the app, so components update when the active language changes.
      reRenderOnLangChange: true,
    },
    preloadLangs: true,
    ...options,
  });
}

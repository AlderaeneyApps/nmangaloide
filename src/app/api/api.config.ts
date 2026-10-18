import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';

export interface NhentaiApiConfig {
  /** Base URL of the API, without a trailing slash. */
  baseUrl: string;
  /**
   * Sent as `User-Agent` on native platforms. The API asks for
   * `AppName/version (contact or project URL)`.
   */
  userAgent: string;
}

export const DEFAULT_NHENTAI_API_CONFIG: NhentaiApiConfig = {
  baseUrl: 'https://nhentai.net/api/v2',
  userAgent: 'nMangaloide/0.0.1 (https://github.com/AlderaeneyApps/nmangaloide)',
};

export const NHENTAI_API_CONFIG = new InjectionToken<NhentaiApiConfig>('NHENTAI_API_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_NHENTAI_API_CONFIG,
});

export function provideNhentaiApi(config: Partial<NhentaiApiConfig> = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: NHENTAI_API_CONFIG, useValue: { ...DEFAULT_NHENTAI_API_CONFIG, ...config } },
  ]);
}

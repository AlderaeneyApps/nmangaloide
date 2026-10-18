import { TestBed } from '@angular/core/testing';

import { PRIVACY_SCREEN_CONFIG, PRIVACY_SCREEN_PLUGIN, PrivacyScreenService } from './privacy-screen.service';

describe('PrivacyScreenService', () => {
  let plugin: { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn>; isEnabled: ReturnType<typeof vi.fn> };
  let service: PrivacyScreenService;

  beforeEach(() => {
    plugin = {
      enable: vi.fn().mockResolvedValue({ success: true }),
      disable: vi.fn(),
      isEnabled: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: PRIVACY_SCREEN_PLUGIN, useValue: plugin }] });
    service = TestBed.inject(PrivacyScreenService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('enables the privacy screen on Android/iOS', async () => {
    await expect(service.enable(true)).resolves.toBe(true);
    expect(plugin.enable).toHaveBeenCalledWith(PRIVACY_SCREEN_CONFIG);
  });

  it('covers the app with the dark launch image on iOS and the dim cover on Android', () => {
    expect(PRIVACY_SCREEN_CONFIG).toEqual({
      android: { dimBackground: true, privacyModeOnActivityHidden: 'dim' },
      ios: { blurEffect: 'none' },
    });
  });

  it('does nothing in the browser', async () => {
    await expect(service.enable(false)).resolves.toBe(false);
    expect(plugin.enable).not.toHaveBeenCalled();
  });

  it('does not throw when the plugin fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    plugin.enable.mockRejectedValue(new Error('not implemented'));
    await expect(service.enable(true)).resolves.toBe(false);
  });
});

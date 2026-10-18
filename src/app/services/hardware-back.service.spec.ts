import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavController, Platform } from '@ionic/angular';

import { EXIT_APP, HARDWARE_BACK_PRIORITY, HardwareBackService } from './hardware-back.service';

describe('HardwareBackService', () => {
  let handler: (() => void) | null;
  let subscribeWithPriority: ReturnType<typeof vi.fn>;
  let navigateBack: ReturnType<typeof vi.fn>;
  let exitApp: ReturnType<typeof vi.fn>;
  let url: string;
  let service: HardwareBackService;

  beforeEach(() => {
    handler = null;
    url = '/';
    subscribeWithPriority = vi.fn((_priority: number, fn: () => void) => {
      handler = fn;
      return { unsubscribe: vi.fn() };
    });
    navigateBack = vi.fn().mockResolvedValue(true);
    exitApp = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: Platform, useValue: { backButton: { subscribeWithPriority } } },
        { provide: NavController, useValue: { navigateBack } },
        { provide: Router, useValue: { get url() { return url; } } },
        { provide: EXIT_APP, useValue: exitApp },
      ],
    });
    service = TestBed.inject(HardwareBackService);
  });

  function press(at: string) {
    url = at;
    handler!();
  }

  it('takes over the back button on Android, below menus and dialogs', () => {
    service.init('android');
    expect(subscribeWithPriority).toHaveBeenCalledWith(HARDWARE_BACK_PRIORITY, expect.any(Function));
    expect(HARDWARE_BACK_PRIORITY).toBeLessThan(99); // Ionic's menu priority; overlays are 100
    expect(HARDWARE_BACK_PRIORITY).toBeGreaterThan(0); // Ionic's own navigation
  });

  it('does nothing on iOS or the web, and registers only once', () => {
    service.init('ios');
    service.init('web');
    expect(subscribeWithPriority).not.toHaveBeenCalled();
    service.init('android');
    service.init('android');
    expect(subscribeWithPriority).toHaveBeenCalledTimes(1);
  });

  it('closes the app on the home page', () => {
    service.init('android');
    press('/');
    expect(exitApp).toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('closes the app on the home page even while a search is shown', () => {
    service.init('android');
    press('/?q=artist:%22someone%22');
    expect(exitApp).toHaveBeenCalled();
  });

  it('goes home from Settings, Tags, Downloaded and Favorites', () => {
    service.init('android');
    for (const page of ['/settings', '/tags', '/downloaded', '/favorites']) {
      press(page);
    }
    expect(navigateBack.mock.calls).toEqual([['/'], ['/'], ['/'], ['/']]);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('goes back one step from the reader and the gallery page', () => {
    service.init('android');
    press('/gallery/42/read?from=%2Fgallery%2F42');
    expect(navigateBack).toHaveBeenLastCalledWith('/gallery/42');
    press('/gallery/42?from=%2F%3Fq%3Dtag%3A%22yuri%22');
    expect(navigateBack).toHaveBeenLastCalledWith('/?q=tag:"yuri"');
  });
});

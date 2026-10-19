import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { DEVICE_PREFERENCES } from '../native/download-folder';
import { FakePreferences } from '../testing/fake-download-storage';
import { SetupService, setupDoneGuard, setupPendingGuard } from './setup.service';

describe('SetupService', () => {
  let preferences: FakePreferences;

  beforeEach(() => {
    preferences = new FakePreferences();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DEVICE_PREFERENCES, useValue: preferences }],
    });
  });

  const run = (guard: typeof setupDoneGuard) =>
    TestBed.runInInjectionContext(() => guard({} as never, {} as never)) as Promise<boolean | UrlTree>;
  const url = (result: boolean | UrlTree) => (result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result);

  it('sends every page to the welcome pages until the setup is done', async () => {
    expect(url(await run(setupDoneGuard))).toBe('/welcome');
    expect(url(await run(setupPendingGuard))).toBe(true);

    await TestBed.inject(SetupService).complete();
    expect(preferences.values.get('setup_done')).toBe('1');
    expect(url(await run(setupDoneGuard))).toBe(true);
    expect(url(await run(setupPendingGuard))).toBe('/');
  });

  it('remembers a finished setup', async () => {
    preferences.values.set('setup_done', '1');
    expect(await TestBed.inject(SetupService).isDone()).toBe(true);
  });

  it("doesn't lock the user out if the setting can't be read", async () => {
    vi.spyOn(preferences, 'get').mockRejectedValue(new Error('broken'));
    expect(await TestBed.inject(SetupService).isDone()).toBe(true);
  });
});

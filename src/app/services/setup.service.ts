import { Injectable, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { DEVICE_PREFERENCES } from '../native/download-folder';

const SETUP_KEY = 'setup_done';

/** Whether the first-start setup (the welcome pages) has been finished on this device. */
@Injectable({ providedIn: 'root' })
export class SetupService {
  private readonly preferences = inject(DEVICE_PREFERENCES);
  private done: Promise<boolean> | null = null;

  isDone(): Promise<boolean> {
    this.done ??= this.preferences.get(SETUP_KEY).then(
      (value) => value === '1',
      // If it can't be read, don't lock the user out of the app.
      () => true,
    );
    return this.done;
  }

  async complete(): Promise<void> {
    await this.preferences.set(SETUP_KEY, '1');
    this.done = Promise.resolve(true);
  }
}

/** Sends the user to the welcome pages until the setup is done. */
export const setupDoneGuard: CanActivateFn = async () => {
  const [setup, router] = [inject(SetupService), inject(Router)];
  return (await setup.isDone()) || router.parseUrl('/welcome');
};

/** The welcome pages are only for the first start. */
export const setupPendingGuard: CanActivateFn = async () => {
  const [setup, router] = [inject(SetupService), inject(Router)];
  return !(await setup.isDone()) || router.parseUrl('/');
};

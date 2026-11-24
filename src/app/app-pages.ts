import { Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IsActiveMatchOptions, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { isTopLevelPage } from './navigation';

export interface AppPage {
  title: string;
  url: string;
  icon: string;
}

/** Pages in the bottom bar. */
export const BOTTOM_BAR_PAGES: readonly AppPage[] = [
  { title: 'MENU.HOME', url: '/', icon: 'home' },
  { title: 'MENU.TAGS', url: '/tags', icon: 'pricetag' },
  { title: 'MENU.FAVORITES', url: '/favorites', icon: 'heart' },
  { title: 'MENU.DOWNLOADED', url: '/downloaded', icon: 'download' },
];

/** Pages in the header menu button's popover. */
export const MENU_PAGES: readonly AppPage[] = [
  { title: 'MENU.DOWNLOADING', url: '/downloading', icon: 'cloud-download' },
  { title: 'MENU.SETTINGS', url: '/settings', icon: 'settings' },
];

/** A link stays highlighted whatever its query params are. */
export const ACTIVE_OPTIONS: IsActiveMatchOptions = {
  paths: 'exact',
  queryParams: 'ignored',
  fragment: 'ignored',
  matrixParams: 'ignored',
};

/** The current router URL, updated after every navigation. */
export function injectCurrentUrl(): Signal<string> {
  const router = inject(Router);
  return toSignal(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => router.url),
    ),
    { initialValue: router.url },
  );
}

/**
 * Whether the current page is a top-level page. Top-level pages open on top of the
 * home page so iOS's swipe back has somewhere to go. Moving between them replaces
 * the current one, so it's always home.
 */
export function injectOnTopLevelPage(): Signal<boolean> {
  const url = injectCurrentUrl();
  return computed(() => isTopLevelPage(url()));
}

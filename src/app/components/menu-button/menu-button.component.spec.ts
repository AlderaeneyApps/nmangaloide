import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';

import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { MenuButtonComponent } from './menu-button.component';

import { describe, beforeEach, afterEach, it, expect } from 'vitest';

describe('MenuButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuButtonComponent, getTranslocoTestingModule()],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();
  });

  afterEach(() => {
    document.querySelectorAll('ion-popover').forEach((el) => el.remove());
  });

  async function openMenu(url = '/') {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(MenuButtonComponent);
    await router.navigateByUrl(url);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('ion-button[data-action="menu"]') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const links = (fixture: Awaited<ReturnType<typeof openMenu>>) =>
    fixture.debugElement.queryAll(By.directive(RouterLink)).map((el) => el.injector.get(RouterLink));

  it('should show a labelled menu button', () => {
    const fixture = TestBed.createComponent(MenuButtonComponent);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('ion-button[data-action="menu"]') as HTMLElement;
    expect(button.getAttribute('aria-label')).toBe('Menu');
  });

  it('should list the pages that are not in the bottom bar', async () => {
    const router = TestBed.inject(Router);
    const fixture = await openMenu();
    expect(links(fixture).map((link) => router.serializeUrl(link.urlTree!))).toEqual(['/downloading', '/settings']);
  });

  it('should link the menu title to the GitHub repository', async () => {
    await openMenu();
    const link = document.querySelector('ion-popover ion-list-header a') as HTMLAnchorElement;
    expect(link.textContent).toBe('nMangaloide');
    expect(link.href).toEqual('https://github.com/AlderaeneyApps/nmangaloide');
  });

  it('should open a page on top of the home page', async () => {
    expect(links(await openMenu('/')).every((link) => !link.replaceUrl)).toBe(true);
  });

  it('should replace the current top-level page, so back is still the home page', async () => {
    expect(links(await openMenu('/tags?from=%2F')).every((link) => link.replaceUrl)).toBe(true);
  });
});

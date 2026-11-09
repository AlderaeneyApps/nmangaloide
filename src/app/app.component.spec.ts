import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { IonRouterLink } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

import { AppComponent } from './app.component';
import { provideFakeDatabase } from './testing/fake-database';
import { getTranslocoTestingModule } from './testing/transloco-testing';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, getTranslocoTestingModule()],
      providers: [provideRouter([]), provideFakeDatabase()],
    }).compileComponents();
  });

  // Capacitor Preferences uses localStorage on the web, under the "CapacitorStorage." prefix.
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should have menu labels', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    // ion-label is a scoped Stencil component whose slot content is relocated
    // asynchronously, so wait for hydration before reading textContent (ROU-10799).
    await fixture.whenStable();
    const app = fixture.nativeElement;
    const menuItems = app.querySelectorAll('ion-label');
    expect(menuItems.length).toEqual(6);
    expect(menuItems[0].innerHTML).toContain('Home');
    expect(menuItems[1].innerHTML).toContain('Tags');
    expect(menuItems[2].innerHTML).toContain('Favorites');
    expect(menuItems[3].innerHTML).toContain('Downloaded');
    expect(menuItems[4].innerHTML).toContain('Downloading');
    expect(menuItems[5].innerHTML).toContain('Settings');
  });

  it('should have urls', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const app = fixture.nativeElement;
    expect(app.querySelectorAll('ion-item').length).toEqual(6);
    // Ionic applies the rendered href through its own async write queue, so
    // reading the DOM attribute is flaky (FW-6264). Assert the routerLink
    // binding directly, which resolves synchronously.
    const router = TestBed.inject(Router);
    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((el) => el.injector.get(RouterLink));
    expect(links.length).toEqual(6);
    expect(router.serializeUrl(links[0].urlTree!)).toEqual('/');
    expect(router.serializeUrl(links[1].urlTree!)).toEqual('/tags');
    expect(router.serializeUrl(links[2].urlTree!)).toEqual('/favorites');
    expect(router.serializeUrl(links[3].urlTree!)).toEqual('/downloaded');
    expect(router.serializeUrl(links[4].urlTree!)).toEqual('/downloading');
    expect(router.serializeUrl(links[5].urlTree!)).toEqual('/settings');
  });

  it('should link the sidebar straight to each page, without a back parameter', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const fixture = TestBed.createComponent(AppComponent);
    await router.navigateByUrl('/gallery/1?from=%2F');
    fixture.detectChanges();

    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((el) => router.serializeUrl(el.injector.get(RouterLink).urlTree!));
    // Those pages' back buttons always go to the home page.
    expect(links).toEqual(['/', '/tags', '/favorites', '/downloaded', '/downloading', '/settings']);
  });

  describe('sidebar navigation stack (iOS swipe back)', () => {
    const sidebarLink = (fixture: ComponentFixture<AppComponent>, url: string) => {
      const router = TestBed.inject(Router);
      const item = fixture.debugElement
        .queryAll(By.directive(RouterLink))
        .find((el) => router.serializeUrl(el.injector.get(RouterLink).urlTree!) === url)!;
      return { link: item.injector.get(RouterLink), direction: item.injector.get(IonRouterLink).routerDirection };
    };

    const openAt = async (url: string) => {
      const router = TestBed.inject(Router);
      router.resetConfig([{ path: '**', children: [] }]);
      const fixture = TestBed.createComponent(AppComponent);
      await router.navigateByUrl(url);
      fixture.detectChanges();
      return fixture;
    };

    it('should open a page on top of the home page', async () => {
      const { link, direction } = sidebarLink(await openAt('/'), '/tags');
      expect(direction).toBe('forward');
      expect(link.replaceUrl).toBe(false);
    });

    it('should replace the current sidebar page, so back is still the home page', async () => {
      const { link, direction } = sidebarLink(await openAt('/tags?from=%2F'), '/favorites');
      expect(direction).toBe('forward');
      expect(link.replaceUrl).toBe(true);
    });

    it('should not replace a gallery page', async () => {
      expect(sidebarLink(await openAt('/gallery/1'), '/tags').link.replaceUrl).toBe(false);
    });

    it('should reset the stack when going home', async () => {
      const { link, direction } = sidebarLink(await openAt('/tags'), '/');
      expect(direction).toBe('root');
      expect(link.replaceUrl).toBe(false);
    });
  });

  it('should link the menu title to the GitHub repository', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('ion-list-header a');
    expect(link.textContent).toBe('nMangaloide');
    expect(link.href).toEqual('https://github.com/AlderaeneyApps/nmangaloide');
  });

  it('should use the saved language setting', async () => {
    localStorage.setItem('CapacitorStorage.lang', 'es');
    const fixture = TestBed.createComponent(AppComponent);
    const transloco = TestBed.inject(TranslocoService);

    await vi.waitFor(() => expect(transloco.getActiveLang()).toBe('es'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('ion-label').innerHTML).toContain('Inicio');
  });

  it('should fall back to English for an unsupported device language and save it', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ko-KR');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ko-KR']);
    TestBed.createComponent(AppComponent);
    const transloco = TestBed.inject(TranslocoService);

    await vi.waitFor(() => expect(localStorage.getItem('CapacitorStorage.lang')).toBe('en'));
    expect(transloco.getActiveLang()).toBe('en');
  });

  for (const [device, expected] of [
    ['zh-TW', 'zh-Hant'],
    ['zh-CN', 'zh-Hans'],
    ['ja-JP', 'ja'],
  ]) {
    it(`starts in ${expected} on a phone set to ${device}`, async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(device);
      TestBed.createComponent(AppComponent);
      const transloco = TestBed.inject(TranslocoService);

      await vi.waitFor(() => expect(localStorage.getItem('CapacitorStorage.lang')).toBe(expected));
      expect(transloco.getActiveLang()).toBe(expected);
    });
  }
});

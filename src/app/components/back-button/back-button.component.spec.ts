import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { NavController } from '@ionic/angular';
import { BehaviorSubject } from 'rxjs';

import { safeBackUrl } from '../../navigation';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { BackButtonComponent } from './back-button.component';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('BackButtonComponent', () => {
  let queryParams: BehaviorSubject<ParamMap>;
  let navigateBack: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({}));
    navigateBack = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [BackButtonComponent, getTranslocoTestingModule()],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams } },
        { provide: NavController, useValue: { navigateBack } },
      ],
    }).compileComponents();
  });

  function render(params: Record<string, string>, inputs: Record<string, unknown> = {}) {
    queryParams.next(convertToParamMap(params));
    const fixture = TestBed.createComponent(BackButtonComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const button = (fixture: ReturnType<typeof render>) => fixture.nativeElement.querySelector('ion-button') as HTMLElement | null;

  it('should be hidden without a from parameter', () => {
    expect(render({}).nativeElement.querySelector('ion-button')).toBeNull();
  });

  it('should go back to the page in the from parameter', () => {
    const fixture = render({ from: '/favorites?q=test' });
    const button = fixture.nativeElement.querySelector('ion-button') as HTMLElement;
    expect(button.getAttribute('aria-label')).toBe('Back');

    button.click();

    expect(navigateBack).toHaveBeenCalledWith('/favorites?q=test');
  });

  it('should update when the parameter changes', () => {
    const fixture = render({ from: '/tags' });
    queryParams.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-button')).toBeNull();
  });

  it('should ignore links to other sites', () => {
    for (const from of ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'tags']) {
      expect(render({ from }).nativeElement.querySelector('ion-button')).toBeNull();
    }
  });

  describe('home target (Settings, Tags, Downloaded, Favorites)', () => {
    it('is always shown and always goes to the home page', () => {
      const fixture = render({}, { target: 'home' });
      button(fixture)!.click();
      expect(navigateBack).toHaveBeenCalledWith('/');
    });

    it('ignores any from parameter', () => {
      const fixture = render({ from: '/gallery/5' }, { target: 'home' });
      button(fixture)!.click();
      expect(navigateBack).toHaveBeenCalledWith('/');
    });
  });

  describe('previous target (gallery, reader)', () => {
    it('prefers the from parameter over the fallback', () => {
      const fixture = render({ from: '/?q=artist:%22x%22' }, { fallback: '/' });
      button(fixture)!.click();
      expect(navigateBack).toHaveBeenCalledWith('/?q=artist:%22x%22');
    });

    it('uses the fallback when there is no from parameter', () => {
      const fixture = render({}, { fallback: '/gallery/42' });
      button(fixture)!.click();
      expect(navigateBack).toHaveBeenCalledWith('/gallery/42');
    });

    it('uses the fallback when the from parameter points outside the app', () => {
      const fixture = render({ from: 'https://evil.example' }, { fallback: '/' });
      button(fixture)!.click();
      expect(navigateBack).toHaveBeenCalledWith('/');
    });
  });
});

describe('safeBackUrl', () => {
  it('accepts in-app paths only', () => {
    expect(safeBackUrl('/')).toBe('/');
    expect(safeBackUrl('/tags?x=1')).toBe('/tags?x=1');
    expect(safeBackUrl('//evil.example')).toBeNull();
    expect(safeBackUrl('/\\evil.example')).toBeNull();
    expect(safeBackUrl('https://evil.example')).toBeNull();
    expect(safeBackUrl('')).toBeNull();
    expect(safeBackUrl(null)).toBeNull();
  });
});

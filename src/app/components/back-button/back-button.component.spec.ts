import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { NavController } from '@ionic/angular';
import { BehaviorSubject } from 'rxjs';

import { safeBackUrl } from '../../navigation';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { BackButtonComponent } from './back-button.component';

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

  function render(params: Record<string, string>) {
    queryParams.next(convertToParamMap(params));
    const fixture = TestBed.createComponent(BackButtonComponent);
    fixture.detectChanges();
    return fixture;
  }

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

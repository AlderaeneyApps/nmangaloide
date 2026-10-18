import { TestBed } from '@angular/core/testing';

import { TagState } from '../../services/tag-preferences.service';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { TagToggleComponent } from './tag-toggle.component';

describe('TagToggleComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagToggleComponent, getTranslocoTestingModule()],
    }).compileComponents();
  });

  function render(state: TagState | null) {
    const fixture = TestBed.createComponent(TagToggleComponent);
    fixture.componentRef.setInput('name', 'full color');
    fixture.componentRef.setInput('count', 1234);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return { fixture, button: fixture.nativeElement.querySelector('button') as HTMLButtonElement };
  }

  it('shows the name, count and state', () => {
    const { button } = render(null);
    expect(button.textContent).toContain('full color');
    expect(button.textContent).toContain('1234');
    expect(button.getAttribute('aria-label')).toBe('full color, not selected');
    expect(button.classList.contains('enabled')).toBe(false);
  });

  it('marks enabled and disabled tags', () => {
    const enabled = render('enabled').button;
    expect(enabled.classList.contains('enabled')).toBe(true);
    expect(enabled.getAttribute('aria-label')).toBe('full color, enabled');

    const disabled = render('disabled').button;
    expect(disabled.classList.contains('disabled')).toBe(true);
    expect(disabled.getAttribute('aria-label')).toBe('full color, disabled');
  });

  it('emits cycle when tapped', () => {
    const { fixture, button } = render(null);
    const toggled = vi.fn();
    fixture.componentInstance.cycle.subscribe(toggled);
    button.click();
    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it('shows an optional type label', () => {
    const fixture = TestBed.createComponent(TagToggleComponent);
    fixture.componentRef.setInput('name', 'someone');
    fixture.componentRef.setInput('kind', 'Artist');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.querySelector('.kind')?.textContent).toBe('Artist');
    expect(button.getAttribute('aria-label')).toBe('someone (Artist), not selected');
  });
});

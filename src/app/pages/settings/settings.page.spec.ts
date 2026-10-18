import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { LanguageService } from '../../services/language.service';
import { getTranslocoTestingModule } from '../../testing/transloco-testing';
import { SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPage, getTranslocoTestingModule()],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('should show the title and the language selector', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-title')?.textContent).toContain('Settings');
    expect((el.querySelector('ion-select') as HTMLIonSelectElement).label).toBe('Language');
    const options = [...el.querySelectorAll('ion-select-option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['English', 'Español', 'Català', 'Français', 'Deutsch']);
  });

  it('should switch and save the language when a new one is picked', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('ion-select') as HTMLElement;
    select.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'fr' } }));

    await vi.waitFor(() => expect(localStorage.getItem('CapacitorStorage.lang')).toBe('fr'));
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('fr');
    expect(TestBed.inject(LanguageService).current()).toBe('fr');
  });
});

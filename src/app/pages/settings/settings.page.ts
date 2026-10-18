import { Component, inject } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonList,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { LanguageService } from '../../services/language.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonSelect,
    IonSelectOption,
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class SettingsPage {
  protected readonly language = inject(LanguageService);

  protected async onLanguageChange(event: Event): Promise<void> {
    const lang = (event as CustomEvent<{ value: string }>).detail.value;
    if (lang && lang !== this.language.current()) {
      await this.language.setLanguage(lang);
    }
  }
}

import { Component } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-favorites',
  templateUrl: './favorites.page.html',
  imports: [IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, TranslocoPipe],
})
export class FavoritesPage {}

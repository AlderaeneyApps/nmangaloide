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

import { BackButtonComponent } from '../../components/back-button/back-button.component';

@Component({
  selector: 'app-downloaded',
  templateUrl: './downloaded.page.html',
  imports: [IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, TranslocoPipe, BackButtonComponent],
})
export class DownloadedPage {}

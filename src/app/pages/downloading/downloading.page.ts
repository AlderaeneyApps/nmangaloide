import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonProgressBar,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { closeCircleOutline, refreshOutline } from 'ionicons/icons';

import { BackButtonComponent } from '../../components/back-button/back-button.component';
import { BACK_PARAM } from '../../navigation';
import { DownloadJob, DownloadService } from '../../services/download.service';

/** Galleries downloading in the background, with live page counts. */
@Component({
  selector: 'app-downloading',
  templateUrl: './downloading.page.html',
  styleUrls: ['./downloading.page.scss'],
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonProgressBar,
    IonButton,
    IonIcon,
    IonText,
    TranslocoPipe,
    BackButtonComponent,
  ],
})
export class DownloadingPage implements OnInit {
  protected readonly downloads = inject(DownloadService);
  protected readonly backParams = { [BACK_PARAM]: '/downloading' };

  constructor() {
    addIcons({ refreshOutline, closeCircleOutline });
  }

  ngOnInit(): void {
    this.downloads.init().catch(() => undefined);
  }

  protected progress(job: DownloadJob): number {
    return job.totalPages > 0 ? job.downloadedPages / job.totalPages : 0;
  }

  protected retry(job: DownloadJob): void {
    void this.downloads.retry(job.id);
  }

  protected cancel(job: DownloadJob): void {
    void this.downloads.remove(job.id);
  }
}

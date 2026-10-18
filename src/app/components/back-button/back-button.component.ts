import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonButton, IonIcon, NavController } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { arrowBackSharp, chevronBackOutline } from 'ionicons/icons';
import { map } from 'rxjs';

import { BACK_PARAM, safeBackUrl } from '../../navigation';

/**
 * Header button that goes back to the page in the `from` query parameter.
 * Renders nothing when the parameter is missing or isn't an in-app path.
 * Place it inside `<ion-buttons slot="start">`.
 */
@Component({
  selector: 'app-back-button',
  templateUrl: './back-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, TranslocoPipe],
})
export class BackButtonComponent {
  private readonly navController = inject(NavController);

  protected readonly backUrl = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => safeBackUrl(params.get(BACK_PARAM)))),
    { initialValue: null },
  );

  constructor() {
    addIcons({ chevronBackOutline, arrowBackSharp });
  }

  protected goBack(): void {
    const url = this.backUrl();
    if (url) {
      void this.navController.navigateBack(url);
    }
  }
}

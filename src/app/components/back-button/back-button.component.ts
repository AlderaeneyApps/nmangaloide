import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonButton, IonIcon, NavController } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { arrowBackSharp, chevronBackOutline } from 'ionicons/icons';
import { map } from 'rxjs';

import { BACK_PARAM, safeBackUrl } from '../../navigation';

/**
 * Where the header back button goes:
 * - `home`: always the home page (top-level pages like Settings or Tags).
 * - `previous`: the page in the `from` query parameter (e.g. gallery → home with
 *   its search, reader → gallery), or `fallback` when there's none.
 */
export type BackTarget = 'home' | 'previous';

/**
 * Header back button. Hidden when there's nowhere to go back to.
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

  readonly target = input<BackTarget>('previous');
  /** Used by `previous` when the URL has no (valid) `from` parameter. */
  readonly fallback = input<string | null>(null);

  private readonly fromParam = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => safeBackUrl(params.get(BACK_PARAM)))),
    { initialValue: null },
  );

  protected readonly backUrl = computed(() =>
    this.target() === 'home' ? '/' : (this.fromParam() ?? safeBackUrl(this.fallback())),
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

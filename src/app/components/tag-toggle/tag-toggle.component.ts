import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import { addIcons } from 'ionicons';
import { banOutline, checkmarkCircle, ellipseOutline } from 'ionicons/icons';

import { TagState } from '../../services/tag-preferences.service';

/** A tag button showing its three-way state; emits `cycle` when tapped. */
@Component({
  selector: 'app-tag-toggle',
  templateUrl: './tag-toggle.component.html',
  styleUrls: ['./tag-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon, TranslocoPipe],
})
export class TagToggleComponent {
  readonly name = input.required<string>();
  readonly count = input<number | null>(null);
  /** Optional second line, e.g. the tag's type on the Selected tab. */
  readonly kind = input<string | null>(null);
  readonly state = input<TagState | null>(null);
  readonly disabled = input(false);

  readonly cycle = output<void>();

  protected readonly icon = computed(() => {
    switch (this.state()) {
      case 'enabled':
        return 'checkmark-circle';
      case 'disabled':
        return 'ban-outline';
      default:
        return 'ellipse-outline';
    }
  });

  protected readonly stateKey = computed(() => {
    switch (this.state()) {
      case 'enabled':
        return 'TAGS.STATE_ENABLED';
      case 'disabled':
        return 'TAGS.STATE_DISABLED';
      default:
        return 'TAGS.STATE_NONE';
    }
  });

  constructor() {
    addIcons({ checkmarkCircle, banOutline, ellipseOutline });
  }
}

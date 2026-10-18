import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonCard } from '@ionic/angular';

import { CdnService, GalleryListItem } from '../../api';

/** A gallery's thumbnail with its title underneath, clamped to two lines. */
@Component({
  selector: 'app-gallery-card',
  templateUrl: './gallery-card.component.html',
  styleUrls: ['./gallery-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard],
})
export class GalleryCardComponent {
  private readonly cdn = inject(CdnService);

  readonly gallery = input.required<GalleryListItem>();

  protected readonly imageUrl = computed(() => this.cdn.thumbnailUrl(this.gallery().thumbnail));
  protected readonly title = computed(() => this.gallery().english_title || this.gallery().japanese_title || '');
  /** Reserves the image's space before it loads, so the grid doesn't jump. */
  protected readonly aspectRatio = computed(() => {
    const { thumbnail_width: width, thumbnail_height: height } = this.gallery();
    return width > 0 && height > 0 ? `${width} / ${height}` : '2 / 3';
  });
}

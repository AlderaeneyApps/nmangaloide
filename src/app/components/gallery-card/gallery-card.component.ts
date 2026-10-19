import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonCard } from '@ionic/angular';
import { TranslocoPipe } from '@jsverse/transloco';

import { CdnService, GalleryListItem } from '../../api';
import { GalleryLanguage, LANGUAGE_FLAGS, languageOfTagIds } from '../../services/gallery-language.service';

/** Longest title shown on a card; longer ones are cut and end in "...". */
export const MAX_TITLE_LENGTH = 40;

/**
 * Cuts `text` to `max` characters (counting what a reader sees as one character,
 * e.g. a Japanese kana or an emoji) and adds "..." when it was longer.
 */
export function truncateTitle(text: string, max = MAX_TITLE_LENGTH): string {
  const characters = Array.from(text);
  if (characters.length <= max) {
    return text;
  }
  return `${characters.slice(0, max).join('').trimEnd()}...`;
}

/**
 * A gallery's thumbnail with its title underneath: cut to MAX_TITLE_LENGTH
 * characters, and never more than two lines on narrow screens. Japanese, Chinese
 * and English galleries get a small flag in the cover's top right corner.
 */
@Component({
  selector: 'app-gallery-card',
  templateUrl: './gallery-card.component.html',
  styleUrls: ['./gallery-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, TranslocoPipe],
})
export class GalleryCardComponent {
  private readonly cdn = inject(CdnService);

  readonly gallery = input.required<GalleryListItem>();
  /** Optional image to show instead of the CDN thumbnail, e.g. a cover saved as a `data:` URL. */
  readonly coverSrc = input<string | null>(null);
  /**
   * The gallery's language when it's already known (saved galleries); otherwise it's
   * found from the gallery's `tag_ids`.
   */
  readonly language = input<GalleryLanguage | null | undefined>(undefined);

  protected readonly flagLanguage = computed(() => {
    const known = this.language();
    return known !== undefined ? known : languageOfTagIds(this.gallery().tag_ids);
  });
  protected readonly flagSrc = computed(() => {
    const language = this.flagLanguage();
    return language ? LANGUAGE_FLAGS[language] : null;
  });

  protected readonly imageUrl = computed(() => this.coverSrc() || this.cdn.thumbnailUrl(this.gallery().thumbnail));
  /** The full title, kept for the tooltip and the image's alt text. */
  protected readonly title = computed(() => this.gallery().english_title || this.gallery().japanese_title || '');
  protected readonly shortTitle = computed(() => truncateTitle(this.title()));
  /** Reserves the image's space before it loads, so the grid doesn't jump. */
  protected readonly aspectRatio = computed(() => {
    const { thumbnail_width: width, thumbnail_height: height } = this.gallery();
    return width > 0 && height > 0 ? `${width} / ${height}` : '2 / 3';
  });
}

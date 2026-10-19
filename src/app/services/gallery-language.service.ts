import { GalleryDetailResponse } from '../api';

/** Languages shown as a flag on gallery cards. */
export type GalleryLanguage = 'japanese' | 'chinese' | 'english';
export const FLAG_LANGUAGES: readonly GalleryLanguage[] = ['japanese', 'chinese', 'english'];

/** The flag image for each language (English uses the UK flag, as nhentai does). */
export const LANGUAGE_FLAGS: Record<GalleryLanguage, string> = {
  japanese: '/assets/flags/jp.svg',
  chinese: '/assets/flags/cn.svg',
  english: '/assets/flags/gb.svg',
};

/** nhentai's ids of the language tags (`/language/japanese/`…); tag ids never change. */
export const LANGUAGE_TAG_IDS: Record<GalleryLanguage, number> = {
  japanese: 6346,
  chinese: 29963,
  english: 12227,
};

const LANGUAGE_BY_TAG_ID = new Map<number, GalleryLanguage>(
  (Object.entries(LANGUAGE_TAG_IDS) as [GalleryLanguage, number][]).map(([language, id]) => [id, language]),
);

export function isFlagLanguage(value: unknown): value is GalleryLanguage {
  return FLAG_LANGUAGES.includes(value as GalleryLanguage);
}

/** The flag language of a gallery's details (its `language` tag), or null. */
export function languageOfDetails(gallery: Pick<GalleryDetailResponse, 'tags'>): GalleryLanguage | null {
  const tag = (gallery.tags ?? []).find((t) => t.type === 'language' && isFlagLanguage(t.name));
  return tag ? (tag.name as GalleryLanguage) : null;
}

/** The flag language among a gallery's `tag_ids` (search results only have ids), or null. */
export function languageOfTagIds(tagIds: readonly number[] | null | undefined): GalleryLanguage | null {
  for (const id of tagIds ?? []) {
    const language = LANGUAGE_BY_TAG_ID.get(id);
    if (language) {
      return language;
    }
  }
  return null;
}

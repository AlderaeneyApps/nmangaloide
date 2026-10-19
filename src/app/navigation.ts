/** Query parameter holding the page to go back to, e.g. `/settings?from=/tags`. */
export const BACK_PARAM = 'from';

/**
 * Returns `url` if it is a safe in-app path to go back to, or null. Only paths
 * starting with a single `/` are accepted, so the parameter can't be used to send
 * the user to another site (`//evil.example`, `https://…`, `javascript:…`).
 */
export function safeBackUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    return null;
  }
  return url;
}

/** Query parameter of the home page holding a gallery search, e.g. `/?q=artist:"someone"`. */
export const SEARCH_PARAM = 'q';

/** A single `type:"name"` search filter, parsed back for display. */
export interface SearchFilter {
  type: string;
  name: string;
}

/** Parses a `type:"name"` search (as built by buildGallerySearchQuery); null for anything else. */
export function parseSingleFilter(query: string): SearchFilter | null {
  const match = /^([a-z]+):"([^"]+)"$/.exec(query.trim());
  return match ? { type: match[1], name: match[2] } : null;
}

/** Top-level pages, reached from the side menu: back always goes to the home page. */
export const TOP_LEVEL_PAGES: readonly string[] = ['tags', 'favorites', 'downloaded', 'downloading', 'settings'];

/**
 * Where "back" goes from `url`, the same rules as the header back button:
 * - home page: null (nothing to go back to, so Android's back button closes the app)
 * - Settings, Tags, Downloaded, Downloading, Favorites: the home page
 * - gallery page: the `from` page (e.g. home with its search), else the home page
 * - reader: the `from` page (its gallery page), else that gallery's page
 * - welcome (first-start setup): null, so Android's back button closes the app
 * - anything else: the home page
 */
export function backUrlFor(url: string): string | null {
  const parsed = new URL(url, 'https://app.invalid');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const from = safeBackUrl(parsed.searchParams.get(BACK_PARAM));

  if (segments.length === 0 || segments[0] === 'welcome') {
    return null;
  }
  if (segments[0] === 'gallery' && segments.length === 2) {
    return from ?? '/';
  }
  if (segments[0] === 'gallery' && segments.length === 3 && segments[2] === 'read') {
    return from ?? `/gallery/${segments[1]}`;
  }
  return '/';
}

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

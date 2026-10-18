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

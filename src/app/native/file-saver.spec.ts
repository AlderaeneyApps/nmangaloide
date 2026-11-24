import { isCancelled } from './file-saver';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('isCancelled', () => {
  it('recognises a closed picker or share sheet', () => {
    expect(isCancelled(Object.assign(new Error('whatever'), { code: 'CANCELLED' }))).toBe(true);
    expect(isCancelled(new Error('Share canceled'))).toBe(true);
    expect(isCancelled(new DOMException('Share canceled by the user', 'AbortError'))).toBe(true);
  });

  it('treats anything else as a real error', () => {
    expect(isCancelled(new Error('disk full'))).toBe(false);
    expect(isCancelled(Object.assign(new Error('x'), { code: 'WRITE_FAILED' }))).toBe(false);
    // Only the known cancellations count, not any message that mentions one.
    expect(isCancelled(new Error('Request cancelled by the server'))).toBe(false);
    expect(isCancelled('cancelled')).toBe(false);
    expect(isCancelled(null)).toBe(false);
  });
});

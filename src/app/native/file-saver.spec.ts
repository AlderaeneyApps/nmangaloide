import { isCancelled } from './file-saver';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('isCancelled', () => {
  it('recognises a closed picker or share sheet', () => {
    expect(isCancelled(Object.assign(new Error('whatever'), { code: 'CANCELLED' }))).toBe(true);
    expect(isCancelled(new Error('Save cancelled'))).toBe(true);
    expect(isCancelled(new Error('Share canceled'))).toBe(true);
  });

  it('treats anything else as a real error', () => {
    expect(isCancelled(new Error('disk full'))).toBe(false);
    expect(isCancelled(Object.assign(new Error('x'), { code: 'WRITE_FAILED' }))).toBe(false);
  });
});

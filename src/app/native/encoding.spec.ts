import { base64ToBytes, base64ToText, blobToDataUrl, bytesToBase64, stripDataUrl, textToBase64 } from './encoding';

import { describe, it, expect } from 'vitest';

describe('encoding', () => {
  it('round-trips bytes through base64, also past one chunk', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    expect(bytesToBase64(new Uint8Array([97, 98, 99]))).toBe(btoa('abc'));
  });

  it('round-trips UTF-8 text through base64', () => {
    const text = 'Ünïcødé 日本語 ✓';
    expect(base64ToText(textToBase64(text))).toBe(text);
    expect(textToBase64('abc')).toBe(btoa('abc'));
  });

  it('reads a Blob as a data: URL, and strips the prefix', async () => {
    const url = await blobToDataUrl(new Blob(['ABC'], { type: 'image/webp' }));
    expect(url).toBe('data:image/webp;base64,QUJD');
    expect(stripDataUrl(url)).toBe('QUJD');
    expect(stripDataUrl('QUJD')).toBe('QUJD');
  });
});

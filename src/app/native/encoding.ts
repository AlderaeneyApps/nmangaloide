/**
 * Conversions between bytes, base64, text and Blobs. Files cross the Capacitor bridge as
 * base64, and `<img>` / the database take `data:` URLs, so these are needed in several places.
 */

/** Bytes as base64, in chunks (spreading a large array into one call overflows the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** UTF-8 text as base64. */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** base64 back to UTF-8 text. */
export function base64ToText(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

/** A Blob as a `data:` URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The base64 part of a `data:` URL (a string without a comma is returned as is). */
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

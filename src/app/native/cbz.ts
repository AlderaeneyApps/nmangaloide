import { GalleryDetailResponse } from '../api';

/**
 * Minimal ZIP support for CBZ files (a CBZ is a ZIP of page images).
 *
 * Writing uses "stored" entries (no compression: page images are already
 * compressed), produced one entry at a time so a large comic never has to be held
 * in memory or sent to the native side in one piece. Reading also accepts
 * "deflated" entries, so CBZ files made by other apps open too.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** General purpose flag: file names are UTF-8. */
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/**
 * Builds a ZIP file piece by piece: `add()` returns the bytes for one entry (to be
 * appended to the file), `finish()` the closing directory.
 */
export class ZipWriter {
  private readonly records: CentralRecord[] = [];
  private offset = 0;
  private readonly time: number;
  private readonly date: number;

  constructor(now = new Date()) {
    this.time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    this.date = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  }

  add(fileName: string, data: Uint8Array): Uint8Array {
    const name = new TextEncoder().encode(fileName);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, UTF8_NAMES, true);
    view.setUint16(8, STORED, true);
    view.setUint16(10, this.time, true);
    view.setUint16(12, this.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    this.records.push({ name, crc, size: data.length, offset: this.offset });
    this.offset += header.length + data.length;
    return concat([header, data]);
  }

  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    let size = 0;
    for (const record of this.records) {
      const entry = new Uint8Array(46 + record.name.length);
      const view = new DataView(entry.buffer);
      view.setUint32(0, CENTRAL_HEADER, true);
      view.setUint16(4, 20, true); // version made by
      view.setUint16(6, 20, true); // version needed
      view.setUint16(8, UTF8_NAMES, true);
      view.setUint16(10, STORED, true);
      view.setUint16(12, this.time, true);
      view.setUint16(14, this.date, true);
      view.setUint32(16, record.crc, true);
      view.setUint32(20, record.size, true);
      view.setUint32(24, record.size, true);
      view.setUint16(28, record.name.length, true);
      view.setUint32(42, record.offset, true);
      entry.set(record.name, 46);
      parts.push(entry);
      size += entry.length;
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
    view.setUint16(8, this.records.length, true);
    view.setUint16(10, this.records.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, this.offset, true);
    parts.push(end);
    return concat(parts);
  }
}

export interface ZipEntry {
  name: string;
  /** The entry's contents (decompressed if needed). */
  bytes(): Promise<Uint8Array>;
}

/** The files in a ZIP, from its central directory. Throws if it isn't a ZIP. */
export function readZip(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is at the end, before an optional comment of up to 64 KB.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error('Not a ZIP file');
  }
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(position, true) !== CENTRAL_HEADER) {
      throw new Error('Damaged ZIP file');
    }
    const method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = decoder.decode(zip.subarray(position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) {
      continue; // a folder
    }
    entries.push({
      name,
      bytes: async () => {
        if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
          throw new Error('Damaged ZIP file');
        }
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const data = zip.subarray(start, start + compressedSize);
        if (method === STORED) {
          return data;
        }
        if (method === DEFLATED) {
          return inflate(data);
        }
        throw new Error(`Unsupported compression in ${name}`);
      },
    });
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const LANGUAGE_CODES: Record<string, string> = { english: 'en', japanese: 'ja', chinese: 'zh' };

/**
 * ComicInfo.xml, the metadata file most comic readers understand (title, artists,
 * tags, page count), so the CBZ files also look right in other apps.
 */
export function comicInfoXml(gallery: GalleryDetailResponse): string {
  const names = (type: string) => gallery.tags.filter((tag) => tag.type === type).map((tag) => tag.name);
  const language = names('language').map((name) => LANGUAGE_CODES[name]).find(Boolean);
  const fields: [string, string | number | undefined][] = [
    ['Title', gallery.title.english || gallery.title.pretty],
    ['Series', gallery.title.pretty || undefined],
    ['Writer', names('artist').join(', ') || undefined],
    ['Penciller', names('artist').join(', ') || undefined],
    ['Publisher', names('group').join(', ') || undefined],
    ['Genre', names('parody').join(', ') || undefined],
    ['Tags', names('tag').join(', ') || undefined],
    ['Characters', names('character').join(', ') || undefined],
    ['Web', `https://nhentai.net/g/${gallery.id}/`],
    ['PageCount', gallery.pages.length],
    ['LanguageISO', language],
    ['Manga', 'YesAndRightToLeft'],
    ['AgeRating', 'Adults Only 18+'],
  ];
  const body = fields
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `  <${key}>${escapeXml(String(value))}</${key}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n${body}\n</ComicInfo>\n`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
}

import { GalleryDetailResponse, TagResponse } from '../api';
import { ZipWriter, base64ToBytes, bytesToBase64, comicInfoXml, concat, crc32, readZip } from './cbz';

const text = (value: string) => new TextEncoder().encode(value);

describe('CBZ files', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes a ZIP one entry at a time that reads back', async () => {
    const zip = new ZipWriter(new Date(2026, 9, 19, 9, 30, 10));
    const image = new Uint8Array([0, 1, 2, 250, 255]);
    const file = concat([zip.add('gallery.json', text('{"id":1}')), zip.add('001.webp', image), zip.finish()]);

    const entries = readZip(file);
    expect(entries.map((entry) => entry.name)).toEqual(['gallery.json', '001.webp']);
    expect(new TextDecoder().decode(await entries[0].bytes())).toBe('{"id":1}');
    expect([...(await entries[1].bytes())]).toEqual([...image]);
    // Local header signature, "stored" entries, UTF-8 names.
    expect([...file.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new DataView(file.buffer).getUint16(6, true)).toBe(0x0800);
    expect(new DataView(file.buffer).getUint16(8, true)).toBe(0);
  });

  it('reads compressed (deflated) entries, as made by other apps', async () => {
    const data = text('page '.repeat(200));
    const deflated = new Uint8Array(
      await new Response(new Response(data).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    // A stored entry patched to say "deflated", with the compressed data.
    const zip = new ZipWriter();
    const entry = zip.add('001.jpg', deflated);
    const end = zip.finish();
    new DataView(entry.buffer).setUint16(8, 8, true);
    const central = new DataView(end.buffer);
    central.setUint16(10, 8, true);
    central.setUint32(24, data.length, true);

    const [page] = readZip(concat([entry, end]));
    expect(new TextDecoder().decode(await page.bytes())).toBe('page '.repeat(200));
  });

  it('skips folders and rejects files that are not ZIPs', () => {
    const zip = new ZipWriter();
    const file = concat([zip.add('pages/', new Uint8Array()), zip.add('pages/001.png', text('x')), zip.finish()]);
    expect(readZip(file).map((entry) => entry.name)).toEqual(['pages/001.png']);
    expect(() => readZip(text('not a zip at all, sorry'))).toThrow('Not a ZIP file');
  });

  it('converts between bytes and base64', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it('describes the gallery in ComicInfo.xml for other comic readers', () => {
    const tag = (name: string, type: string): TagResponse => ({ id: 1, name, slug: name, type, url: '', count: 1 });
    const gallery = {
      id: 42,
      title: { english: 'Tom & "Jerry" <3', japanese: null, pretty: 'Tom & Jerry' },
      tags: [tag('someone', 'artist'), tag('other', 'artist'), tag('yuri', 'tag'), tag('english', 'language')],
      pages: [{}, {}, {}],
    } as unknown as GalleryDetailResponse;
    const xml = comicInfoXml(gallery);
    expect(xml).toContain('<Title>Tom &amp; &quot;Jerry&quot; &lt;3</Title>');
    expect(xml).toContain('<Writer>someone, other</Writer>');
    expect(xml).toContain('<Tags>yuri</Tags>');
    expect(xml).toContain('<PageCount>3</PageCount>');
    expect(xml).toContain('<LanguageISO>en</LanguageISO>');
    expect(xml).toContain('<Web>https://nhentai.net/g/42/</Web>');
    expect(xml).not.toContain('<Publisher>');
  });
});

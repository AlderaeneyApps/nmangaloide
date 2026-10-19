import { DownloadFolderPlugin, base64ToText, mimeTypeOf, pickedFolderStorage, stripDataUrl, textToBase64 } from './download-folder';

describe('download folder helpers', () => {
  it('round-trips UTF-8 text through base64', () => {
    const text = JSON.stringify({ title: '日本語のタイトル — ça marche' });
    expect(base64ToText(textToBase64(text))).toBe(text);
    expect(textToBase64('abc')).toBe(btoa('abc'));
  });

  it('knows the image types', () => {
    expect(mimeTypeOf('001.webp')).toBe('image/webp');
    expect(mimeTypeOf('002.JPG')).toBe('image/jpeg');
    expect(mimeTypeOf('gallery.json')).toBe('application/json');
    expect(mimeTypeOf('notes')).toBe('application/octet-stream');
    expect(stripDataUrl('data:image/webp;base64,QUJD')).toBe('QUJD');
  });

  it('passes the picked folder and the path to the Android plugin', async () => {
    const plugin: DownloadFolderPlugin = {
      pick: vi.fn().mockResolvedValue({ uri: 'content://tree', name: 'Comics' }),
      hasAccess: vi.fn().mockResolvedValue({ granted: true }),
      list: vi.fn().mockResolvedValue({ entries: [{ name: '001.webp', type: 'file', uri: 'content://doc/1' }] }),
      writeFile: vi.fn().mockResolvedValue({ uri: 'content://doc/1' }),
      appendFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue({ uri: 'content://doc/2' }),
      readFile: vi.fn().mockResolvedValue({ data: 'QUJD' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const storage = pickedFolderStorage(plugin);
    expect(storage.kind).toBe('picked');
    expect(await storage.pick()).toEqual({ uri: 'content://tree', name: 'Comics' });
    expect(await storage.hasAccess('content://tree')).toBe(true);
    expect(await storage.list('content://tree', ['42'])).toHaveLength(1);
    expect(plugin.list).toHaveBeenCalledWith({ uri: 'content://tree', path: ['42'] });
    await storage.write('content://tree', ['42'], '001.webp', 'QUJD', 'image/webp');
    expect(plugin.writeFile).toHaveBeenCalledWith({ uri: 'content://tree', path: ['42'], name: '001.webp', data: 'QUJD', mimeType: 'image/webp' });
    expect(await storage.read('content://tree', ['42'], '001.webp')).toBe('QUJD');
    await storage.append('content://tree', [], '42.cbz.part', 'QUJD');
    expect(plugin.appendFile).toHaveBeenCalledWith({ uri: 'content://tree', path: [], name: '42.cbz.part', data: 'QUJD' });
    await storage.rename('content://tree', [], '42.cbz.part', '42.cbz');
    expect(plugin.rename).toHaveBeenCalledWith({ uri: 'content://tree', path: [], from: '42.cbz.part', to: '42.cbz' });
    // Large files are read through the web view's server; if that fails, through the plugin.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const bytes = await storage.readBytes('content://tree', [], { name: '42.cbz', type: 'file', uri: 'content://doc/2' });
    expect([...bytes]).toEqual([65, 66, 67]);
    fetchSpy.mockRestore();
    await storage.remove('content://tree', ['42']);
    expect(plugin.remove).toHaveBeenCalledWith({ uri: 'content://tree', path: ['42'] });
    // Without a picked folder nothing reaches the plugin.
    await expect(storage.list(null, [])).rejects.toThrow('No download folder chosen');
  });
});

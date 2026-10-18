import { TestBed } from '@angular/core/testing';

import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { AppSettingsService } from './app-settings.service';

describe('AppSettingsService', () => {
  let db: FakeDatabase;
  let service: AppSettingsService;

  beforeEach(() => {
    db = new FakeDatabase();
    TestBed.configureTestingModule({ providers: [provideFakeDatabase(db)] });
    service = TestBed.inject(AppSettingsService);
  });

  it('defaults to infinite scroll', async () => {
    await service.load();
    expect(service.readerMode()).toBe('scroll');
  });

  it('loads the saved reader mode', async () => {
    db.settings.set('reader_mode', 'paged');
    await service.load();
    expect(service.readerMode()).toBe('paged');
  });

  it('ignores an unknown saved value', async () => {
    db.settings.set('reader_mode', 'sideways');
    await service.load();
    expect(service.readerMode()).toBe('scroll');
  });

  it('saves the reader mode', async () => {
    await service.setReaderMode('paged');
    expect(db.settings.get('reader_mode')).toBe('paged');
    expect(service.readerMode()).toBe('paged');
    expect(db.runs[0].statement).toContain('ON CONFLICT(key)');
  });

  it('keeps the previous mode when saving fails', async () => {
    db.failNext = new Error('disk full');
    await expect(service.setReaderMode('paged')).rejects.toThrow('disk full');
    expect(service.readerMode()).toBe('scroll');
  });

  it('rejects unknown modes', async () => {
    await expect(service.setReaderMode('sideways' as never)).rejects.toThrow('Unknown reader mode');
    expect(db.runs).toEqual([]);
  });

  it('reloads after a backup import', async () => {
    await service.load();
    db.settings.set('reader_mode', 'paged');
    await service.reload();
    expect(service.readerMode()).toBe('paged');
  });
});

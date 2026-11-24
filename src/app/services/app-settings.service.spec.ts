import { TestBed } from '@angular/core/testing';

import { ApiKeyService } from '../api/api-key.service';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { AppSettingsService } from './app-settings.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

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

  it('defaults the page direction to right to left and loads a saved one', async () => {
    await service.load();
    expect(service.pageDirection()).toBe('rtl');
    db.settings.set('page_direction', 'ltr');
    await service.reload();
    expect(service.pageDirection()).toBe('ltr');
    db.settings.set('page_direction', 'up');
    await service.reload();
    expect(service.pageDirection()).toBe('rtl');
  });

  it('saves the page direction', async () => {
    await service.setPageDirection('ltr');
    expect(db.settings.get('page_direction')).toBe('ltr');
    expect(service.pageDirection()).toBe('ltr');
    await expect(service.setPageDirection('up' as never)).rejects.toThrow('Unknown page direction');
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

  describe('theme', () => {
    it('defaults to the system theme', async () => {
      await service.load();
      expect(service.theme()).toBe('system');
    });

    it('loads and saves the theme', async () => {
      db.settings.set('theme', 'oled');
      await service.load();
      expect(service.theme()).toBe('oled');

      await service.setTheme('light');
      expect(db.settings.get('theme')).toBe('light');
      expect(service.theme()).toBe('light');
    });

    it('ignores an unknown saved theme and rejects unknown ones', async () => {
      db.settings.set('theme', 'neon');
      await service.load();
      expect(service.theme()).toBe('system');
      await expect(service.setTheme('neon' as never)).rejects.toThrow('Unknown theme');
    });

    it('keeps the reader mode and theme independent', async () => {
      await service.setTheme('dark');
      await service.setReaderMode('paged');
      expect(db.settings.get('theme')).toBe('dark');
      expect(db.settings.get('reader_mode')).toBe('paged');
    });
  });

  describe('API key', () => {
    it('has no key by default', async () => {
      await service.load();
      expect(service.apiKey()).toBeNull();
      expect(TestBed.inject(ApiKeyService).hasKey()).toBe(false);
    });

    it('loads the saved key into the API key service', async () => {
      db.settings.set('api_key', 'secret');
      await service.load();
      expect(TestBed.inject(ApiKeyService).key()).toBe('secret');
    });

    it('saves a trimmed key, and an empty value removes it', async () => {
      await service.setApiKey('  secret  ');
      expect(db.settings.get('api_key')).toBe('secret');
      expect(service.apiKey()).toBe('secret');

      await service.setApiKey('   ');
      expect(db.settings.get('api_key')).toBe('');
      expect(service.apiKey()).toBeNull();
    });

    it('keeps the previous key when saving fails', async () => {
      await service.setApiKey('old');
      db.failNext = new Error('disk full');
      await expect(service.setApiKey('new')).rejects.toThrow('disk full');
      expect(service.apiKey()).toBe('old');
    });
  });
});

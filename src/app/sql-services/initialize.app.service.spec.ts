import { TestBed } from '@angular/core/testing';

import { InitializeAppService } from './initialize.app.service';
import { DatabaseService } from './database.service';
import { SQLiteService } from './sqlite.service';
import { DB_NMANGALOIDE } from '../constants';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('InitializeAppService', () => {
  let service: InitializeAppService;
  let sqliteServiceMock: {
    platform: string;
    initializePlugin: ReturnType<typeof vi.fn>;
    initWebStore: ReturnType<typeof vi.fn>;
    saveToStore: ReturnType<typeof vi.fn>;
  };

  let databaseServiceMock: { open: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    databaseServiceMock = { open: vi.fn().mockResolvedValue(undefined), fail: vi.fn() };
    sqliteServiceMock = {
      platform: 'web',
      initializePlugin: vi.fn().mockResolvedValue(true),
      initWebStore: vi.fn().mockResolvedValue(undefined),
      saveToStore: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        InitializeAppService,
        { provide: SQLiteService, useValue: sqliteServiceMock },
        { provide: DatabaseService, useValue: databaseServiceMock },
      ],
    });
    service = TestBed.inject(InitializeAppService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize the web store on web', async () => {
    await service.initializeApp();

    expect(sqliteServiceMock.initializePlugin).toHaveBeenCalled();
    expect(sqliteServiceMock.initWebStore).toHaveBeenCalled();
    expect(databaseServiceMock.open).toHaveBeenCalled();
    expect(sqliteServiceMock.saveToStore).toHaveBeenCalledWith(DB_NMANGALOIDE);
    expect(service.platform).toBe('web');
    expect(service.isAppInit).toBe(true);
  });

  it('should skip the web store on native platforms', async () => {
    sqliteServiceMock.platform = 'android';

    await service.initializeApp();

    expect(sqliteServiceMock.initWebStore).not.toHaveBeenCalled();
    expect(databaseServiceMock.open).toHaveBeenCalled();
    expect(sqliteServiceMock.saveToStore).not.toHaveBeenCalled();
    expect(service.isAppInit).toBe(true);
  });

  it('fails the database (instead of leaving it waiting forever) when the web store cannot start', async () => {
    const error = new Error('no IndexedDB');
    sqliteServiceMock.initWebStore.mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.initializeApp()).resolves.toBeUndefined();

    expect(databaseServiceMock.open).not.toHaveBeenCalled();
    expect(databaseServiceMock.fail).toHaveBeenCalledWith(error);
    expect(service.isAppInit).toBe(false);
  });

  it('also fails the database when the plugin itself cannot start', async () => {
    sqliteServiceMock.initializePlugin.mockRejectedValue(new Error('no plugin'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await service.initializeApp();

    expect(databaseServiceMock.fail).toHaveBeenCalled();
    expect(databaseServiceMock.open).not.toHaveBeenCalled();
  });
});

import { TestBed } from '@angular/core/testing';

import { InitializeAppService } from './initialize.app.service';
import { DatabaseService } from './database.service';
import { SQLiteService } from './sqlite.service';
import { DB_NMANGALOIDE } from '../constants';

describe('InitializeAppService', () => {
  let service: InitializeAppService;
  let sqliteServiceMock: {
    platform: string;
    initializePlugin: ReturnType<typeof vi.fn>;
    initWebStore: ReturnType<typeof vi.fn>;
    saveToStore: ReturnType<typeof vi.fn>;
  };

  let databaseServiceMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    databaseServiceMock = { open: vi.fn().mockResolvedValue(undefined) };
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
});

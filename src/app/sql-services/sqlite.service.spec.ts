import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { SQLiteService } from './sqlite.service';

describe('SQLiteService', () => {
  let service: SQLiteService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SQLiteService],
    });
    service = TestBed.inject(SQLiteService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize the plugin on web as non-native', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');

    await expect(service.initializePlugin()).resolves.toBe(true);

    expect(service.platform).toBe('web');
    expect(service.native).toBe(false);
    expect(service.isService).toBe(true);
    expect(service.sqliteConnection).toBeDefined();
  });

  it('should flag android as native', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    await service.initializePlugin();

    expect(service.native).toBe(true);
  });
});

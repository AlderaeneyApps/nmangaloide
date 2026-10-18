import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { SQLiteService, generatePassphrase } from './sqlite.service';

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

  describe('encryptionOptions', () => {
    let connection: Record<string, ReturnType<typeof vi.fn>>;

    function useConnection(options: { config: boolean; stored: boolean; exists: boolean; encrypted?: boolean }) {
      connection = {
        isInConfigEncryption: vi.fn().mockResolvedValue({ result: options.config }),
        isSecretStored: vi.fn().mockResolvedValue({ result: options.stored }),
        setEncryptionSecret: vi.fn().mockResolvedValue(undefined),
        isDatabase: vi.fn().mockResolvedValue({ result: options.exists }),
        isDatabaseEncrypted: vi.fn().mockResolvedValue({ result: options.encrypted ?? false }),
      };
      service.native = true;
      service.sqliteConnection = connection as never;
    }

    it('does not encrypt on the web', async () => {
      service.native = false;
      await expect(service.encryptionOptions('db')).resolves.toEqual({ encrypted: false, mode: 'no-encryption' });
    });

    it('does not encrypt when encryption is off in the config', async () => {
      useConnection({ config: false, stored: false, exists: false });
      await expect(service.encryptionOptions('db')).resolves.toEqual({ encrypted: false, mode: 'no-encryption' });
      expect(connection['setEncryptionSecret']).not.toHaveBeenCalled();
    });

    it('creates a passphrase on first launch and creates the database encrypted', async () => {
      useConnection({ config: true, stored: false, exists: false });
      await expect(service.encryptionOptions('db')).resolves.toEqual({ encrypted: true, mode: 'secret' });
      expect(connection['setEncryptionSecret']).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    });

    it('reuses the stored passphrase for an encrypted database', async () => {
      useConnection({ config: true, stored: true, exists: true, encrypted: true });
      await expect(service.encryptionOptions('db')).resolves.toEqual({ encrypted: true, mode: 'secret' });
      expect(connection['setEncryptionSecret']).not.toHaveBeenCalled();
    });

    it('encrypts an existing unencrypted database', async () => {
      useConnection({ config: true, stored: true, exists: true, encrypted: false });
      await expect(service.encryptionOptions('db')).resolves.toEqual({ encrypted: true, mode: 'encryption' });
    });
  });

  it('generates distinct 256-bit passphrases', () => {
    const a = generatePassphrase();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generatePassphrase()).not.toBe(a);
  });
});

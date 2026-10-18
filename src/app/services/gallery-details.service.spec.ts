import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { GalleriesService } from '../api';
import { GalleryDetailsService } from './gallery-details.service';
import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';

describe('GalleryDetailsService', () => {
  let get: ReturnType<typeof vi.fn>;
  let service: GalleryDetailsService;
  let db: FakeDatabase;

  beforeEach(() => {
    db = new FakeDatabase();
    get = vi.fn((id: number) => of({ id }));
    TestBed.configureTestingModule({ providers: [{ provide: GalleriesService, useValue: { get } }, provideFakeDatabase(db)] });
    service = TestBed.inject(GalleryDetailsService);
  });

  it('fetches a gallery once and shares it', async () => {
    expect(await service.get(1)).toEqual({ id: 1 });
    expect(await service.get(1)).toEqual({ id: 1 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetches again after a failure', async () => {
    get.mockReturnValueOnce(throwError(() => new Error('offline')));
    await expect(service.get(1)).rejects.toThrow('offline');
    expect(await service.get(1)).toEqual({ id: 1 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps only the most recently used galleries', async () => {
    for (let id = 1; id <= 21; id++) {
      await service.get(id);
    }
    await service.get(21);
    expect(get).toHaveBeenCalledTimes(21);
    await service.get(1); // evicted
    expect(get).toHaveBeenCalledTimes(22);
  });

  it('uses the details saved with a favorite instead of calling the API', async () => {
    db.seedSaved({ id: 5, details_json: JSON.stringify({ id: 5, saved: true }) });
    expect(await service.get(5)).toEqual({ id: 5, saved: true });
    expect(get).not.toHaveBeenCalled();
  });
});

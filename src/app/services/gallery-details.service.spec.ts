import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { GalleriesService } from '../api';
import { GalleryDetailsService } from './gallery-details.service';

describe('GalleryDetailsService', () => {
  let get: ReturnType<typeof vi.fn>;
  let service: GalleryDetailsService;

  beforeEach(() => {
    get = vi.fn((id: number) => of({ id }));
    TestBed.configureTestingModule({ providers: [{ provide: GalleriesService, useValue: { get } }] });
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
});

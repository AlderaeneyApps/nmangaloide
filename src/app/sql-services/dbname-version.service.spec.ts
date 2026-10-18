import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, it, expect } from 'vitest';

import { DbnameVersionService } from './dbname-version.service';

describe('DbnameVersionService', () => {
  let service: DbnameVersionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DbnameVersionService],
    });
    service = TestBed.inject(DbnameVersionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return -1 for an unknown database', () => {
    expect(service.getVersion('unknown')).toBe(-1);
  });

  it('should return the version that was set', () => {
    service.set('nmangaloide', 3);
    expect(service.getVersion('nmangaloide')).toBe(3);
  });
});

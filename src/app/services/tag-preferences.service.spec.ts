import { TestBed } from '@angular/core/testing';

import { FakeDatabase, provideFakeDatabase } from '../testing/fake-database';
import { TagInfo, TagPreferencesService, buildGallerySearchQuery, nextTagState } from './tag-preferences.service';

const TAG: TagInfo = { id: 7, name: 'full color', slug: 'full-color', type: 'tag', count: 1234 };

describe('TagPreferencesService', () => {
  let db: FakeDatabase;
  let service: TagPreferencesService;

  beforeEach(() => {
    db = new FakeDatabase();
    TestBed.configureTestingModule({ providers: [provideFakeDatabase(db)] });
    service = TestBed.inject(TagPreferencesService);
  });

  it('cycles not selected → enabled → disabled → not selected', () => {
    expect(nextTagState(null)).toBe('enabled');
    expect(nextTagState('enabled')).toBe('disabled');
    expect(nextTagState('disabled')).toBeNull();
  });

  it('loads saved tags alphabetically, ignoring case', async () => {
    db.seed({ id: 1, name: 'yuri', state: 'enabled' });
    db.seed({ id: 2, name: 'Ahegao', state: 'disabled' });
    db.seed({ id: 3, name: 'big breasts', state: 'enabled' });

    await service.load();

    expect(service.preferences().map((tag) => tag.name)).toEqual(['Ahegao', 'big breasts', 'yuri']);
    expect(service.stateOf(2)).toBe('disabled');
    expect(service.stateOf(99)).toBeNull();
    expect(service.enabledIds()).toEqual([3, 1]);
    expect(service.disabledIds()).toEqual([2]);
  });

  it('saves each step of the cycle to the database', async () => {
    await service.load();

    expect(await service.cycle(TAG)).toBe('enabled');
    expect(db.rows.get(7)).toMatchObject({ name: 'full color', slug: 'full-color', count: 1234, state: 'enabled' });

    expect(await service.cycle(TAG)).toBe('disabled');
    expect(db.rows.get(7)).toMatchObject({ state: 'disabled' });
    expect(service.stateOf(7)).toBe('disabled');

    expect(await service.cycle(TAG)).toBeNull();
    expect(db.rows.has(7)).toBe(false);
    expect(service.preferences()).toEqual([]);
  });

  it('applies rapid taps in order', async () => {
    await Promise.all([service.cycle(TAG), service.cycle(TAG)]);
    expect(service.stateOf(7)).toBe('disabled');
    expect(db.runs.map((run) => run.values[5])).toEqual(['enabled', 'disabled']);
  });

  it('keeps the previous state when saving fails, and recovers', async () => {
    await service.cycle(TAG);
    db.failNext = new Error('disk full');

    await expect(service.cycle(TAG)).rejects.toThrow('disk full');
    expect(service.stateOf(7)).toBe('enabled');

    expect(await service.cycle(TAG)).toBe('disabled');
  });

  it('reloads from the database on request', async () => {
    await service.load();
    db.seed({ id: 1, name: 'yuri', state: 'enabled' });
    await service.load();
    expect(service.preferences()).toEqual([]); // load() is cached
    await service.reload();
    expect(service.preferences().map((tag) => tag.name)).toEqual(['yuri']);
  });

  it('can retry loading after a failure', async () => {
    db.failNext = new Error('locked');
    await expect(service.load()).rejects.toThrow('locked');

    db.seed({ id: 1, name: 'yuri', state: 'enabled' });
    await service.load();
    expect(service.preferences().length).toBe(1);
  });

  it('remembers each tag type and builds the gallery search filter from it', async () => {
    await service.cycle({ id: 1, name: 'full color', slug: 'full-color', type: 'tag', count: 1 });
    await service.cycle({ id: 2, name: 'someone', slug: 'someone', type: 'artist', count: 1 });
    const excluded = { id: 3, name: 'yaoi', slug: 'yaoi', type: 'tag', count: 1 };
    await service.cycle(excluded);
    await service.cycle(excluded);

    expect(db.rows.get(2)).toMatchObject({ type: 'artist' });
    expect(service.searchQuery()).toBe('tag:"full color" artist:"someone" -tag:"yaoi"');
  });
});

describe('buildGallerySearchQuery', () => {
  it('quotes names, negates disabled tags and drops quotes inside names', () => {
    expect(
      buildGallerySearchQuery([
        { type: 'language', name: 'english', state: 'enabled' },
        { type: 'parody', name: 'say "hi"', state: 'disabled' },
      ]),
    ).toBe('language:"english" -parody:"say hi"');
    expect(buildGallerySearchQuery([])).toBe('');
  });
});

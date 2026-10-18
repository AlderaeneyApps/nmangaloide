import { backUrlFor, parseSingleFilter } from './navigation';

describe('parseSingleFilter', () => {
  it('reads a single type:"name" filter', () => {
    expect(parseSingleFilter('artist:"someone"')).toEqual({ type: 'artist', name: 'someone' });
    expect(parseSingleFilter('  tag:"full color" ')).toEqual({ type: 'tag', name: 'full color' });
  });

  it('returns null for anything else', () => {
    expect(parseSingleFilter('tag:"a" tag:"b"')).toBeNull();
    expect(parseSingleFilter('-tag:"a"')).toBeNull();
    expect(parseSingleFilter('free text')).toBeNull();
    expect(parseSingleFilter('')).toBeNull();
  });
});

describe('backUrlFor', () => {
  it('has nowhere to go from the home page, with or without a search', () => {
    expect(backUrlFor('/')).toBeNull();
    expect(backUrlFor('/?q=artist:%22someone%22')).toBeNull();
  });

  it('always goes home from the top-level pages', () => {
    for (const page of ['/tags', '/favorites', '/downloaded', '/downloading', '/settings', '/settings?from=%2Fgallery%2F5']) {
      expect(backUrlFor(page)).toBe('/');
    }
  });

  it('goes from a gallery to the page it was opened from, else home', () => {
    expect(backUrlFor('/gallery/42?from=%2F%3Fq%3Dtag%3A%22yuri%22')).toBe('/?q=tag:"yuri"');
    expect(backUrlFor('/gallery/42')).toBe('/');
  });

  it('goes from the reader to its gallery page', () => {
    expect(backUrlFor('/gallery/42/read?from=%2Fgallery%2F42%3Ffrom%3D%252F')).toBe('/gallery/42?from=%2F');
    expect(backUrlFor('/gallery/42/read')).toBe('/gallery/42');
    expect(backUrlFor('/gallery/42/read?page=3')).toBe('/gallery/42');
  });

  it('never follows a from parameter outside the app', () => {
    expect(backUrlFor('/gallery/42?from=https%3A%2F%2Fevil.example')).toBe('/');
    expect(backUrlFor('/gallery/42/read?from=%2F%2Fevil.example')).toBe('/gallery/42');
  });

  it('goes home from anything else', () => {
    expect(backUrlFor('/unknown/page')).toBe('/');
  });
});

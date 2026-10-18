import { parseSingleFilter } from './navigation';

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

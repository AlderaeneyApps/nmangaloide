import { LANGUAGE_FLAGS, LANGUAGE_TAG_IDS, languageOfDetails, languageOfTagIds } from './gallery-language.service';

const tag = (id: number, name: string) => ({ id, name, slug: name, type: 'language', url: `/language/${name}/`, count: 1 });

describe('gallery languages', () => {
  it("knows nhentai's language tag ids", () => {
    expect(LANGUAGE_TAG_IDS).toEqual({ japanese: 6346, chinese: 29963, english: 12227 });
  });

  it('finds the flag language among a gallery’s tag ids', () => {
    // 17249 is "translated", which comes with the actual language.
    expect(languageOfTagIds([1, 17249, 12227, 2])).toBe('english');
    expect(languageOfTagIds([6346])).toBe('japanese');
    expect(languageOfTagIds([29963, 17249])).toBe('chinese');
    expect(languageOfTagIds([1, 145695])).toBeNull();
    expect(languageOfTagIds(undefined)).toBeNull();
  });

  it('reads the language from full gallery details', () => {
    expect(languageOfDetails({ tags: [tag(17249, 'translated'), tag(29963, 'chinese')] as never })).toBe('chinese');
    expect(languageOfDetails({ tags: [tag(145695, 'ukrainian')] as never })).toBeNull();
    expect(languageOfDetails({ tags: [tag(168289, 'japanese | definition revised please read the wiki')] as never })).toBeNull();
  });

  it('has a flag for each language', () => {
    expect(LANGUAGE_FLAGS).toEqual({
      japanese: '/assets/flags/jp.svg',
      chinese: '/assets/flags/cn.svg',
      english: '/assets/flags/gb.svg',
    });
  });
});

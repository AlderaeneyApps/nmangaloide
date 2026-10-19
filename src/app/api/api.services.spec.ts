import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { ApiKeyService } from './api-key.service';
import { BlacklistService } from './blacklist.service';
import { CommentsService } from './comments.service';
import { FavoritesService } from './favorites.service';
import { GalleriesService } from './galleries.service';
import { MetaService } from './meta.service';
import { nhentaiInterceptor } from './nhentai.interceptor';
import { SearchService } from './search.service';
import { TagsService } from './tags.service';
import { UserService } from './user.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

const BASE = 'https://nhentai.net/api/v2';

describe('nhentai API services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([nhentaiInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists galleries with paging params', async () => {
    const result = firstValueFrom(TestBed.inject(GalleriesService).list(2, 50));
    const req = http.expectOne(`${BASE}/galleries?page=2&per_page=50`);
    expect(req.request.method).toBe('GET');
    req.flush({ result: [], num_pages: 0, per_page: 50, total: 0 });
    expect((await result).per_page).toBe(50);
  });

  it('builds gallery detail, tagged, favorite and download requests', () => {
    const galleries = TestBed.inject(GalleriesService);
    galleries.get(177013, ['comments', 'related']).subscribe();
    galleries.get(1).subscribe();
    galleries.listByTag(42, 'popular-week').subscribe();
    galleries.addFavorite(5).subscribe();
    galleries.removeFavorite(5).subscribe();
    galleries.getDownloadUrl(5, 'cbz').subscribe();

    http.expectOne(`${BASE}/galleries/177013?include=comments,related`).flush({});
    http.expectOne(`${BASE}/galleries/1`).flush({});
    http.expectOne(`${BASE}/galleries/tagged?tag_id=42&sort=popular-week&page=1&per_page=25`).flush({});
    expect(http.expectOne({ method: 'POST', url: `${BASE}/galleries/5/favorite` }).request.body).toBeNull();
    http.expectOne({ method: 'DELETE', url: `${BASE}/galleries/5/favorite` }).flush({});
    http.expectOne({ method: 'POST', url: `${BASE}/galleries/5/download?format=cbz` }).flush({});
  });

  it('searches galleries', () => {
    TestBed.inject(SearchService).search('language:english -yaoi', 'popular', 3).subscribe();
    const req = http.expectOne((r) => r.url === `${BASE}/search`);
    expect(req.request.params.get('query')).toBe('language:english -yaoi');
    expect(req.request.params.get('sort')).toBe('popular');
    expect(req.request.params.get('page')).toBe('3');
    req.flush({});
  });

  it('builds tag requests', () => {
    const tags = TestBed.inject(TagsService);
    tags.getByIds([1, 2, 3]).subscribe();
    tags.search({ type: 'artist', query: 'abc', limit: 5 }).subscribe();
    tags.listByType('artist', 'name', 2).subscribe();
    tags.getBySlug('tag', 'full color').subscribe();

    http.expectOne(`${BASE}/tags/ids?ids=1,2,3`).flush([]);
    const search = http.expectOne({ method: 'POST', url: `${BASE}/tags/search` });
    expect(search.request.body).toEqual({ type: 'artist', query: 'abc', limit: 5 });
    search.flush([]);
    http.expectOne(`${BASE}/tags/artist?sort=name&page=2&per_page=25`).flush({});
    http.expectOne(`${BASE}/tags/tag/full%20color`).flush({});
  });

  it('builds comments, favorites, blacklist, user and meta requests', () => {
    TestBed.inject(CommentsService).list(9, 2).subscribe();
    TestBed.inject(CommentsService).count(9).subscribe();
    TestBed.inject(FavoritesService).list(1).subscribe();
    TestBed.inject(FavoritesService).list(2, 'vanilla').subscribe();
    TestBed.inject(BlacklistService).update({ added: [1], removed: [2] }).subscribe();
    TestBed.inject(BlacklistService).getIds().subscribe();
    TestBed.inject(UserService).getMe().subscribe();
    TestBed.inject(MetaService).getConfig().subscribe();

    http.expectOne(`${BASE}/galleries/9/comments?page=2&per_page=50`).flush({});
    http.expectOne(`${BASE}/galleries/9/comments/count`).flush(3);
    http.expectOne(`${BASE}/favorites?page=1`).flush({});
    http.expectOne(`${BASE}/favorites?q=vanilla&page=2`).flush({});
    expect(http.expectOne({ method: 'POST', url: `${BASE}/blacklist` }).request.body).toEqual({
      added: [1],
      removed: [2],
    });
    http.expectOne(`${BASE}/blacklist/ids`).flush([]);
    http.expectOne(`${BASE}/user`).flush({});
    http.expectOne(`${BASE}/config`).flush({});
  });

  describe('interceptor', () => {
    it('sends no Authorization header without an API key', () => {
      TestBed.inject(UserService).getMe().subscribe();
      expect(http.expectOne(`${BASE}/user`).request.headers.has('Authorization')).toBe(false);
    });

    it('adds the API key to nhentai requests only', () => {
      TestBed.inject(ApiKeyService).set('  secret  ');
      TestBed.inject(UserService).getMe().subscribe();
      expect(http.expectOne(`${BASE}/user`).request.headers.get('Authorization')).toBe('Key secret');
    });

    it('does not touch other requests', async () => {
      TestBed.inject(ApiKeyService).set('secret');
      const { HttpClient } = await import('@angular/common/http');
      TestBed.inject(HttpClient).get('/assets/i18n/en.json').subscribe();
      expect(http.expectOne('/assets/i18n/en.json').request.headers.has('Authorization')).toBe(false);
    });
  });
});

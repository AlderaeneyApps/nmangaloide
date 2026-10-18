import { DatabaseService } from '../sql-services/database.service';

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for DatabaseService that understands the statements used by
 * TagPreferencesService, AppSettingsService and SavedGalleriesService. The real SQL is checked against
 * SQLite separately; this keeps component and service specs fast and offline.
 */
export class FakeDatabase {
  readonly rows = new Map<number, Row>();
  /** app_settings rows, by key. */
  readonly settings = new Map<string, string>();
  /** saved_galleries rows, by gallery id. */
  readonly saved = new Map<number, Row>();
  /** downloaded_pages rows, by `${gallery_id}:${page_number}`. */
  readonly pages = new Map<string, Row>();
  readonly runs: { statement: string; values: unknown[] }[] = [];
  /** When set, the next query/run rejects with this error. */
  failNext: Error | null = null;

  async query<T>(statement: string, values: unknown[] = []): Promise<T[]> {
    this.maybeFail();
    const savedQuery = this.querySaved(statement.trim(), values);
    if (savedQuery) {
      return savedQuery as T[];
    }
    if (/^SELECT key, value FROM app_settings/.test(statement.trim())) {
      return [...this.settings].map(([key, value]) => ({ key, value })) as T[];
    }
    if (!/^SELECT .* FROM tag_preferences/s.test(statement.trim())) {
      throw new Error(`FakeDatabase: unsupported query ${statement}`);
    }
    return [...this.rows.values()]
      .sort((a, b) => String(a['name']).localeCompare(String(b['name']), undefined, { sensitivity: 'base' }))
      .map(({ updated_at: _updatedAt, ...row }) => row) as T[];
  }

  async run(statement: string, values: unknown[] = []): Promise<void> {
    this.maybeFail();
    this.runs.push({ statement, values });
    const sql = statement.trim();
    if (this.runSaved(sql, values)) {
      return;
    }
    if (sql.startsWith('DELETE FROM tag_preferences')) {
      this.rows.delete(values[0] as number);
    } else if (sql.startsWith('INSERT INTO app_settings')) {
      this.settings.set(values[0] as string, values[1] as string);
    } else if (sql.startsWith('INSERT INTO tag_preferences')) {
      const [id, name, slug, type, count, state, updatedAt] = values;
      this.rows.set(id as number, { id, name, slug, type, count, state, updated_at: updatedAt });
    } else {
      throw new Error(`FakeDatabase: unsupported statement ${statement}`);
    }
  }

  /** Seeds a saved preference directly. */
  seed(row: { id: number; name: string; state: 'enabled' | 'disabled'; count?: number }): void {
    this.rows.set(row.id, { slug: row.name, type: 'tag', count: row.count ?? 0, updated_at: 0, ...row });
  }

  /** Seeds a saved gallery row directly (a favorite unless overridden). */
  seedSaved(row: Partial<Row> & { id: number }): void {
    this.saved.set(row.id, {
      media_id: String(row.id),
      title_english: `Gallery ${row.id}`,
      title_japanese: null,
      title_pretty: `Gallery ${row.id}`,
      num_pages: 1,
      num_favorites: 0,
      upload_date: 0,
      details_json: JSON.stringify({ id: row.id }),
      cover_path: null,
      cover_width: 0,
      cover_height: 0,
      cover_base64: null,
      is_favorite: 1,
      favorited_at: row.id,
      is_downloaded: 0,
      downloaded_at: null,
      downloaded_files: null,
      download_status: null,
      updated_at: 0,
      ...row,
    });
  }

  /** Seeds a downloaded page directly. */
  seedPage(galleryId: number, pageNumber: number, data = `data:image/webp;base64,${galleryId}-${pageNumber}`): void {
    this.pages.set(`${galleryId}:${pageNumber}`, { gallery_id: galleryId, page_number: pageNumber, data_base64: data });
  }

  private pagesOf(galleryId: number): Row[] {
    return [...this.pages.values()]
      .filter((row) => row['gallery_id'] === galleryId)
      .sort((a, b) => Number(a['page_number']) - Number(b['page_number']));
  }

  private querySaved(sql: string, values: unknown[]): Row[] | null {
    const pick = (rows: Row[], columns: string) =>
      rows.map((row) => Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c] ?? null])));
    const sql1 = sql.replace(/\s+/g, ' ');
    let match = /^SELECT (.+) FROM saved_galleries WHERE is_favorite = 1 ORDER BY favorited_at DESC$/.exec(sql1);
    if (match) {
      return pick(
        [...this.saved.values()]
          .filter((row) => row['is_favorite'] === 1)
          .sort((a, b) => Number(b['favorited_at']) - Number(a['favorited_at'])),
        match[1],
      );
    }
    match = /^SELECT (.+) FROM saved_galleries WHERE is_downloaded = 1 ORDER BY downloaded_at DESC$/.exec(sql1);
    if (match) {
      return pick(
        [...this.saved.values()]
          .filter((row) => row['is_downloaded'] === 1)
          .sort((a, b) => Number(b['downloaded_at']) - Number(a['downloaded_at'])),
        match[1],
      );
    }
    match = /^SELECT (.+) FROM saved_galleries WHERE download_status IS NOT NULL ORDER BY updated_at$/.exec(sql1);
    if (match) {
      return pick(
        [...this.saved.values()]
          .filter((row) => row['download_status'] !== null && row['download_status'] !== undefined)
          .sort((a, b) => Number(a['updated_at']) - Number(b['updated_at'])),
        match[1],
      );
    }
    if (sql1 === 'SELECT page_number FROM downloaded_pages WHERE gallery_id = ?') {
      return this.pagesOf(values[0] as number).map((row) => ({ page_number: row['page_number'] }));
    }
    if (sql1 === 'SELECT page_number, data_base64 FROM downloaded_pages WHERE gallery_id = ? ORDER BY page_number') {
      return this.pagesOf(values[0] as number).map((row) => ({ page_number: row['page_number'], data_base64: row['data_base64'] }));
    }
    if (sql === 'SELECT details_json FROM saved_galleries WHERE id = ?') {
      const row = this.saved.get(values[0] as number);
      return row ? [{ details_json: row['details_json'] }] : [];
    }
    return null;
  }

  private runSaved(rawSql: string, values: unknown[]): boolean {
    const sql = rawSql.replace(/\s+/g, ' ');
    const update = (id: unknown, changes: Row) => {
      const row = this.saved.get(id as number);
      if (row) {
        Object.assign(row, changes);
      }
    };
    switch (sql) {
      case 'UPDATE saved_galleries SET is_favorite = 1, favorited_at = ?, updated_at = ? WHERE id = ?':
        update(values[2], { is_favorite: 1, favorited_at: values[0], updated_at: values[1] });
        return true;
      case 'UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ? AND is_downloaded = 0':
        if (this.saved.get(values[2] as number)?.['is_downloaded'] === 0) {
          update(values[2], { download_status: values[0], updated_at: values[1] });
        }
        return true;
      case 'UPDATE saved_galleries SET download_status = ?, updated_at = ? WHERE id = ?':
        update(values[2], { download_status: values[0], updated_at: values[1] });
        return true;
      case 'UPDATE saved_galleries SET is_downloaded = 1, downloaded_at = ?, download_status = NULL, updated_at = ? WHERE id = ?':
        update(values[2], { is_downloaded: 1, downloaded_at: values[0], download_status: null, updated_at: values[1] });
        return true;
      case 'UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ? WHERE id = ?':
        update(values[1], { is_downloaded: 0, downloaded_at: null, download_status: null, updated_at: values[0] });
        return true;
      case 'UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = NULL, updated_at = ? WHERE is_downloaded = 1 OR download_status IS NOT NULL':
        for (const row of this.saved.values()) {
          Object.assign(row, { is_downloaded: 0, downloaded_at: null, download_status: null, updated_at: values[0] });
        }
        return true;
      case 'DELETE FROM saved_galleries WHERE id = ? AND is_favorite = 0':
        if (this.saved.get(values[0] as number)?.['is_favorite'] === 0) {
          this.saved.delete(values[0] as number);
        }
        return true;
      case 'DELETE FROM saved_galleries WHERE is_favorite = 0':
        for (const [id, row] of this.saved) {
          if (row['is_favorite'] === 0) {
            this.saved.delete(id);
          }
        }
        return true;
      case 'DELETE FROM downloaded_pages WHERE gallery_id = ?':
        for (const key of [...this.pages.keys()]) {
          if (key.startsWith(`${values[0]}:`)) {
            this.pages.delete(key);
          }
        }
        return true;
      case 'DELETE FROM downloaded_pages':
        this.pages.clear();
        return true;
    }
    if (sql.startsWith('INSERT OR REPLACE INTO downloaded_pages')) {
      const [galleryId, pageNumber, data, width, height, at] = values;
      this.pages.set(`${galleryId}:${pageNumber}`, {
        gallery_id: galleryId,
        page_number: pageNumber,
        data_base64: data,
        width,
        height,
        downloaded_at: at,
      });
      return true;
    }
    if (sql.startsWith('INSERT INTO saved_galleries')) {
      // Columns as written in the statement; literal values (is_favorite = 1) are filled in.
      const columns = /\(([^)]*)\)\s*VALUES/s.exec(sql)![1].split(',').map((column) => column.trim());
      const placeholders = /VALUES \(([^)]*)\)/s.exec(sql)![1].split(',').map((value) => value.trim());
      let next = 0;
      const incoming: Row = {};
      columns.forEach((column, index) => {
        incoming[column] = placeholders[index] === '?' ? values[next++] : Number(placeholders[index]);
      });
      const existing = this.saved.get(incoming['id'] as number);
      // Like the ON CONFLICT clause: flags are kept, and a missing cover keeps the old one.
      this.saved.set(incoming['id'] as number, {
        is_favorite: 0,
        favorited_at: null,
        is_downloaded: 0,
        downloaded_at: null,
        downloaded_files: null,
        download_status: null,
        ...existing,
        ...incoming,
        cover_base64: incoming['cover_base64'] ?? existing?.['cover_base64'] ?? null,
      });
      return true;
    }
    if (sql === 'DELETE FROM saved_galleries WHERE id = ? AND is_downloaded = 0 AND download_status IS NULL') {
      const row = this.saved.get(values[0] as number);
      if (row?.['is_downloaded'] === 0 && (row['download_status'] ?? null) === null) {
        this.saved.delete(values[0] as number);
      }
      return true;
    }
    if (sql === 'UPDATE saved_galleries SET is_favorite = 0, favorited_at = NULL, updated_at = ? WHERE id = ?') {
      const row = this.saved.get(values[1] as number);
      if (row) {
        Object.assign(row, { is_favorite: 0, favorited_at: null, updated_at: values[0] });
      }
      return true;
    }
    return false;
  }

  private maybeFail(): void {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }
}

export function provideFakeDatabase(fake = new FakeDatabase()) {
  return { provide: DatabaseService, useValue: fake };
}

import { DatabaseService } from '../sql-services/database.service';

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for DatabaseService that understands the tag_preferences
 * statements used by TagPreferencesService and AppSettingsService. The real SQL is checked against
 * SQLite separately; this keeps component and service specs fast and offline.
 */
export class FakeDatabase {
  readonly rows = new Map<number, Row>();
  /** app_settings rows, by key. */
  readonly settings = new Map<string, string>();
  readonly runs: { statement: string; values: unknown[] }[] = [];
  /** When set, the next query/run rejects with this error. */
  failNext: Error | null = null;

  async query<T>(statement: string): Promise<T[]> {
    this.maybeFail();
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

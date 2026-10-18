import { Injectable, computed, inject, signal } from '@angular/core';

import { TagResponse } from '../api';
import { DatabaseService } from '../sql-services/database.service';

/** `enabled` tags are wanted, `disabled` ones are purposely excluded. Unselected tags aren't stored. */
export type TagState = 'enabled' | 'disabled';

export interface TagPreference {
  id: number;
  name: string;
  slug: string;
  type: string;
  count: number;
  state: TagState;
}

/** The tag fields needed to save a preference (a TagResponse or a saved TagPreference). */
export type TagInfo = Pick<TagResponse, 'id' | 'name' | 'slug' | 'type' | 'count'>;

/** Click order: not selected → enabled → disabled → not selected. */
export function nextTagState(state: TagState | null): TagState | null {
  switch (state) {
    case null:
      return 'enabled';
    case 'enabled':
      return 'disabled';
    case 'disabled':
      return null;
  }
}

/**
 * Builds the gallery search filter for the saved tags, in the API's query syntax:
 * enabled tags become `type:"name"` and disabled ones `-type:"name"`, e.g.
 * `tag:"full color" artist:"someone" -tag:"yaoi"`.
 */
export function buildGallerySearchQuery(preferences: readonly Pick<TagPreference, 'type' | 'name' | 'state'>[]): string {
  return preferences
    .map(({ type, name, state }) => {
      const term = `${type}:"${name.replace(/"/g, '')}"`;
      return state === 'disabled' ? `-${term}` : term;
    })
    .join(' ');
}

const byName = (a: TagPreference, b: TagPreference) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The user's enabled/disabled tags, kept in the `tag_preferences` SQLite table. */
@Injectable({ providedIn: 'root' })
export class TagPreferencesService {
  private readonly db = inject(DatabaseService);
  private readonly _byId = signal<ReadonlyMap<number, TagPreference>>(new Map());
  private loading: Promise<void> | null = null;
  /** Writes run one after another, so fast repeated taps are saved in order. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Saved tags, alphabetically. */
  readonly preferences = computed(() => [...this._byId().values()].sort(byName));
  readonly enabledIds = computed(() => this.idsWith('enabled'));
  readonly disabledIds = computed(() => this.idsWith('disabled'));
  /** Gallery search filter for the saved tags (see buildGallerySearchQuery). */
  readonly searchQuery = computed(() => buildGallerySearchQuery(this.preferences()));

  /** Reads the saved tags from the database (once; later calls reuse the result). */
  load(): Promise<void> {
    this.loading ??= this.db
      .query<TagPreference>(
        'SELECT id, name, slug, type, count, state FROM tag_preferences ORDER BY name COLLATE NOCASE',
      )
      .then(
        (rows) => this._byId.set(new Map(rows.map((row) => [row.id, row]))),
        (error) => {
          this.loading = null;
          throw error;
        },
      );
    return this.loading;
  }

  /** Re-reads the saved tags, e.g. after a backup was imported. */
  reload(): Promise<void> {
    this.loading = null;
    return this.load();
  }

  /** The tag's saved state, or null when it isn't selected. Reactive when read in a template. */
  stateOf(tagId: number): TagState | null {
    return this._byId().get(tagId)?.state ?? null;
  }

  /** Moves the tag to its next state and saves it. Returns the new state. */
  cycle(tag: TagInfo): Promise<TagState | null> {
    return this.enqueue(async () => {
      const state = nextTagState(this.stateOf(tag.id));
      await this.write(tag, state);
      return state;
    });
  }

  /** Sets the tag's state directly (null removes it). */
  setState(tag: TagInfo, state: TagState | null): Promise<void> {
    return this.enqueue(() => this.write(tag, state));
  }

  private async write(tag: TagInfo, state: TagState | null): Promise<void> {
    if (state === null) {
      await this.db.run('DELETE FROM tag_preferences WHERE id = ?', [tag.id]);
      this._byId.update((current) => {
        const next = new Map(current);
        next.delete(tag.id);
        return next;
      });
      return;
    }
    const preference: TagPreference = {
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      type: tag.type,
      count: tag.count,
      state,
    };
    await this.db.run(
      `INSERT INTO tag_preferences (id, name, slug, type, count, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, slug = excluded.slug, type = excluded.type,
         count = excluded.count, state = excluded.state, updated_at = excluded.updated_at`,
      [preference.id, preference.name, preference.slug, preference.type, preference.count, state, Date.now()],
    );
    this._byId.update((current) => new Map(current).set(tag.id, preference));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work);
    this.writes = result.catch(() => undefined);
    return result;
  }

  private idsWith(state: TagState): number[] {
    return this.preferences()
      .filter((preference) => preference.state === state)
      .map((preference) => preference.id);
  }
}

import { capSQLiteVersionUpgrade } from '@capacitor-community/sqlite';

/**
 * Schema history of the nmangaloide database. Never edit a released version:
 * add a new entry with the next `toVersion` instead.
 */
export const NMANGALOIDE_UPGRADES: capSQLiteVersionUpgrade[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS tag_preferences (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL CHECK (state IN ('enabled', 'disabled')),
        updated_at INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_tag_preferences_name ON tag_preferences (name COLLATE NOCASE);`,
    ],
  },
];

/** The schema version the app expects. */
export const NMANGALOIDE_DB_VERSION = NMANGALOIDE_UPGRADES[NMANGALOIDE_UPGRADES.length - 1].toVersion;

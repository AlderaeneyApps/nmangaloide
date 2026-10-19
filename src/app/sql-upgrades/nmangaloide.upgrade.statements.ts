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
  {
    toVersion: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    ],
  },
  {
    toVersion: 3,
    statements: [
      // One row per gallery kept on the device: a favorite, a download, or both.
      // Everything needed to show it offline lives in the row, so favorites cost no API calls.
      `CREATE TABLE IF NOT EXISTS saved_galleries (
        id INTEGER PRIMARY KEY NOT NULL,
        media_id TEXT NOT NULL,
        title_english TEXT NOT NULL,
        title_japanese TEXT,
        title_pretty TEXT NOT NULL,
        num_pages INTEGER NOT NULL DEFAULT 0,
        num_favorites INTEGER NOT NULL DEFAULT 0,
        upload_date INTEGER NOT NULL DEFAULT 0,
        details_json TEXT NOT NULL,
        cover_path TEXT,
        cover_width INTEGER NOT NULL DEFAULT 0,
        cover_height INTEGER NOT NULL DEFAULT 0,
        cover_base64 TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
        favorited_at INTEGER,
        is_downloaded INTEGER NOT NULL DEFAULT 0 CHECK (is_downloaded IN (0, 1)),
        downloaded_at INTEGER,
        downloaded_files TEXT,
        updated_at INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_saved_galleries_favorites ON saved_galleries (is_favorite, favorited_at);`,
    ],
  },
  {
    toVersion: 4,
    statements: [
      // A download in progress ('queued') or stopped by errors ('failed'); NULL otherwise.
      `ALTER TABLE saved_galleries ADD COLUMN download_status TEXT CHECK (download_status IN ('queued', 'failed'));`,
      // One row per downloaded page, so pages are saved (and resumed) one at a time
      // instead of rewriting one huge column. saved_galleries.downloaded_files stays unused.
      `CREATE TABLE IF NOT EXISTS downloaded_pages (
        gallery_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        data_base64 TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        downloaded_at INTEGER NOT NULL,
        PRIMARY KEY (gallery_id, page_number)
      );`,
    ],
  },
  {
    toVersion: 5,
    statements: [
      // Pages are now image files in the download folder (one subfolder per gallery),
      // so downloads can be moved to another phone. Downloads saved in the database
      // are queued again, to be downloaded into the folder.
      `DROP TABLE IF EXISTS downloaded_pages;`,
      `UPDATE saved_galleries SET is_downloaded = 0, downloaded_at = NULL, download_status = 'queued'
        WHERE is_downloaded = 1 OR download_status IS NOT NULL;`,
    ],
  },
  {
    toVersion: 6,
    statements: [
      // 'japanese', 'chinese' or 'english' (shown as a flag on the cards), '' for others.
      // NULL until filled from details_json (SavedGalleriesService.fillLanguages).
      `ALTER TABLE saved_galleries ADD COLUMN language TEXT;`,
    ],
  },
];

/** The schema version the app expects. */
export const NMANGALOIDE_DB_VERSION = NMANGALOIDE_UPGRADES[NMANGALOIDE_UPGRADES.length - 1].toVersion;

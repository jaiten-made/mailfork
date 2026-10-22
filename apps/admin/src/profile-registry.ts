import { DatabaseSync } from "node:sqlite";

export interface Profile {
  id: number;
  label: string;
  profileAddress: string;
  createdAt: string;
}

const PROFILE_COLUMNS = "id, label, profile_address, created_at";

/** Maps a row selected with PROFILE_COLUMNS, or passes on a missing one. */
function toProfile(row: Record<string, unknown> | undefined): Profile | null {
  if (!row) return null;
  const { id, label, profile_address, created_at } = row;
  return {
    id: id as number,
    label: label as string,
    profileAddress: profile_address as string,
    createdAt: created_at as string,
  };
}

// With about 400,000 Generated Addresses, repeated collisions mean the
// random source is broken, not that the addresses have run out.
const MAX_GENERATION_ATTEMPTS = 10;

export interface ProfileRegistry {
  /**
   * Creates a live Profile with a Generated Address, generating again while
   * the address was ever issued before. The write has committed when this
   * returns.
   */
  createWithGeneratedAddress(
    label: string,
    generateAddress: () => string,
    createdAt: Date,
  ): Profile;
  /** Changes only the Label. Returns null if there is no such Profile. */
  rename(id: number, label: string): Profile | null;
  /** Live Profiles, newest first. */
  listLive(): Profile[];
}

/**
 * The SQLite Profile registry. Rows are never deleted, so the unique
 * `profile_address` column holds every Profile Address ever issued.
 */
export function openProfileRegistry(path: string): ProfileRegistry {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      profile_address TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      retired_at TEXT
    ) STRICT
  `);

  const insert = db.prepare(`
    INSERT INTO profiles (label, profile_address, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (profile_address) DO NOTHING
    RETURNING ${PROFILE_COLUMNS}
  `);

  const updateLabel = db.prepare(`
    UPDATE profiles SET label = ? WHERE id = ?
    RETURNING ${PROFILE_COLUMNS}
  `);

  const selectLive = db.prepare(`
    SELECT ${PROFILE_COLUMNS}
    FROM profiles
    WHERE retired_at IS NULL
    ORDER BY created_at DESC, id DESC
  `);

  return {
    createWithGeneratedAddress(label, generateAddress, createdAt) {
      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const profile = toProfile(insert.get(label, generateAddress(), createdAt.toISOString()));
        if (profile) return profile;
      }
      throw new Error("Every Generated Address tried was issued before");
    },

    rename(id, label) {
      return toProfile(updateLabel.get(label, id));
    },

    listLive() {
      return selectLive.all().flatMap((row) => toProfile(row) ?? []);
    },
  };
}

import { DatabaseSync } from "node:sqlite";

export interface Profile {
  id: number;
  label: string;
  profileAddress: string;
  createdAt: string;
}

interface ProfileRow {
  id: number;
  label: string;
  profile_address: string;
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    label: row.label,
    profileAddress: row.profile_address,
    createdAt: row.created_at,
  };
}

export type ProfileRegistry = ReturnType<typeof openProfileRegistry>;

/**
 * The SQLite Profile registry. Rows are never deleted, so the unique
 * `profile_address` column holds every Profile Address ever issued.
 */
export function openProfileRegistry(path: string) {
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
    RETURNING id, label, profile_address, created_at
  `);

  const selectLive = db.prepare(`
    SELECT id, label, profile_address, created_at
    FROM profiles
    WHERE retired_at IS NULL
    ORDER BY created_at DESC, id DESC
  `);

  const updateLabel = db.prepare(`
    UPDATE profiles SET label = ? WHERE id = ?
    RETURNING id, label, profile_address, created_at
  `);

  return {
    /**
     * Creates a live Profile, or returns null if the Profile Address was
     * ever issued before. The write has committed when this returns.
     */
    create(label: string, profileAddress: string, createdAt: Date): Profile | null {
      const row = insert.get(label, profileAddress, createdAt.toISOString());
      return row ? toProfile(row as unknown as ProfileRow) : null;
    },

    /** Changes only the Label. Returns null if there is no such Profile. */
    rename(id: number, label: string): Profile | null {
      const row = updateLabel.get(label, id);
      return row ? toProfile(row as unknown as ProfileRow) : null;
    },

    /** Live Profiles, newest first. */
    listLive(): Profile[] {
      return (selectLive.all() as unknown as ProfileRow[]).map(toProfile);
    },
  };
}

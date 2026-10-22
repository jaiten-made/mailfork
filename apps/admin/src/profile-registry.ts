import { DatabaseSync } from "node:sqlite";

export interface Profile {
  id: number;
  label: string;
  profileAddress: string;
  createdAt: string;
}

export interface RetiredProfile extends Profile {
  retiredAt: string;
}

const PROFILE_COLUMNS = "id, label, profile_address, created_at";
const RETIRED_PROFILE_COLUMNS = `${PROFILE_COLUMNS}, retired_at`;

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

/** Maps a row selected with RETIRED_PROFILE_COLUMNS, or passes on a missing one. */
function toRetiredProfile(row: Record<string, unknown> | undefined): RetiredProfile | null {
  const profile = toProfile(row);
  if (!profile) return null;
  return { ...profile, retiredAt: row?.retired_at as string };
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
  /**
   * Creates a live Profile with a Custom Address, given normalised. Returns null, creating
   * nothing, if the address was ever issued before. The write has committed
   * when this returns.
   */
  createWithCustomAddress(label: string, profileAddress: string, createdAt: Date): Profile | null;
  /** Whether a live or Retired Profile ever had this normalised Profile Address. */
  wasIssued(profileAddress: string): boolean;
  /** A live or Retired Profile, with retiredAt null while live. Null if there is no such Profile. */
  find(id: number): (Profile & { retiredAt: string | null }) | null;
  /** Changes only the Label of a live Profile. Returns null if there is no such live Profile. */
  rename(id: number, label: string): Profile | null;
  /**
   * Sets the retired-at time of a live Profile. Returns null if there is no
   * such live Profile. Nothing ever clears it again.
   */
  retire(id: number, retiredAt: Date): RetiredProfile | null;
  /** Live Profiles, newest first. */
  listLive(): Profile[];
  /** Retired Profiles, most recently Retired first. */
  listRetired(): RetiredProfile[];
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

  const selectByAddress = db.prepare(`
    SELECT 1 FROM profiles WHERE profile_address = ?
  `);

  const selectById = db.prepare(`
    SELECT ${RETIRED_PROFILE_COLUMNS} FROM profiles WHERE id = ?
  `);

  const updateLabel = db.prepare(`
    UPDATE profiles SET label = ? WHERE id = ? AND retired_at IS NULL
    RETURNING ${PROFILE_COLUMNS}
  `);

  const setRetiredAt = db.prepare(`
    UPDATE profiles SET retired_at = ? WHERE id = ? AND retired_at IS NULL
    RETURNING ${RETIRED_PROFILE_COLUMNS}
  `);

  const selectLive = db.prepare(`
    SELECT ${PROFILE_COLUMNS}
    FROM profiles
    WHERE retired_at IS NULL
    ORDER BY created_at DESC, id DESC
  `);

  const selectRetired = db.prepare(`
    SELECT ${RETIRED_PROFILE_COLUMNS}
    FROM profiles
    WHERE retired_at IS NOT NULL
    ORDER BY retired_at DESC, id DESC
  `);

  return {
    createWithGeneratedAddress(label, generateAddress, createdAt) {
      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const profile = toProfile(insert.get(label, generateAddress(), createdAt.toISOString()));
        if (profile) return profile;
      }
      throw new Error("Every Generated Address tried was issued before");
    },

    createWithCustomAddress(label, profileAddress, createdAt) {
      return toProfile(insert.get(label, profileAddress, createdAt.toISOString()));
    },

    wasIssued(profileAddress) {
      return selectByAddress.get(profileAddress) !== undefined;
    },

    find(id) {
      const row = selectById.get(id);
      const profile = toProfile(row);
      return profile && { ...profile, retiredAt: (row?.retired_at as string | null) ?? null };
    },

    rename(id, label) {
      return toProfile(updateLabel.get(label, id));
    },

    retire(id, retiredAt) {
      return toRetiredProfile(setRetiredAt.get(retiredAt.toISOString(), id));
    },

    listLive() {
      return selectLive.all().flatMap((row) => toProfile(row) ?? []);
    },

    listRetired() {
      return selectRetired.all().flatMap((row) => toRetiredProfile(row) ?? []);
    },
  };
}

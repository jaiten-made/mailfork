// Outside the agreed seams: issue #9 asks for the restic Backup target to be
// tested against a real local repository, restoring to an identical database.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resticBackupTarget } from "./backup.ts";
import { openProfileRegistry } from "./profile-registry.ts";

const CREATED_AT = new Date("2026-10-22T09:30:00.000Z");
const RETIRED_AT = new Date("2026-10-23T14:05:00.000Z");
const PASSWORD = "correct horse battery staple";

const hasRestic = spawnSync("restic", ["version"]).status === 0;

// CI installs restic, so there the test must run rather than skip.
// restic derives its key on every run, so each test takes a few seconds.
describe.skipIf(!hasRestic && !process.env.CI)("the restic Backup target", { timeout: 20_000 }, () => {
  // `restic init` is slow by design, so every test starts from a copy of one empty repository.
  let emptyRepository: string;
  let dir: string;
  let databasePath: string;
  let repository: string;

  /** Runs restic directly against a repository, as the Owner would. */
  function restic(...args: string[]) {
    return resticAt(repository, ...args);
  }

  function resticAt(at: string, ...args: string[]) {
    return execFileSync("restic", ["--quiet", "--no-cache", ...args], {
      env: { PATH: process.env.PATH, RESTIC_REPOSITORY: at, RESTIC_PASSWORD: PASSWORD },
      encoding: "utf8",
    });
  }

  beforeAll(() => {
    emptyRepository = join(mkdtempSync(join(tmpdir(), "private-profile-repository-")), "repository");
    resticAt(emptyRepository, "init");
  });

  afterAll(() => {
    rmSync(join(emptyRepository, ".."), { recursive: true, force: true });
  });

  function target(options: { repository?: string } = {}) {
    return resticBackupTarget({
      databasePath,
      copyPath: join(dir, "data", "backup", "profiles.db"),
      repository: options.repository ?? repository,
      password: PASSWORD,
      r2: { accessKeyId: "unused-locally", secretAccessKey: "unused-locally" },
      cacheDir: join(dir, "cache"),
    });
  }

  const running = () => new AbortController().signal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "private-profile-backup-"));
    databasePath = join(dir, "profiles.db");
    repository = join(dir, "repository");
    const registry = openProfileRegistry(databasePath);
    registry.createWithCustomAddress("Shopping", "shop.2026@profile.example", CREATED_AT);
    const travel = registry.createWithCustomAddress("Travel", "faded.fox.07@profile.example", CREATED_AT);
    registry.retire(travel!.id, RETIRED_AT);
    cpSync(emptyRepository, repository, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("takes a Backup that restores to an identical Profile database", async () => {
    await target().backup("change", running());

    const restored = join(dir, "restored");
    restic("restore", "latest", "--target", restored);
    const registry = openProfileRegistry(join(restored, dir, "data", "backup", "profiles.db"));
    expect(registry.listLive()).toEqual([
      {
        id: 1,
        label: "Shopping",
        profileAddress: "shop.2026@profile.example",
        createdAt: "2026-10-22T09:30:00.000Z",
      },
    ]);
    expect(registry.listRetired()).toEqual([
      {
        id: 2,
        label: "Travel",
        profileAddress: "faded.fox.07@profile.example",
        createdAt: "2026-10-22T09:30:00.000Z",
        retiredAt: "2026-10-23T14:05:00.000Z",
      },
    ]);
  });

  it.each(["change", "nightly", "startup"] as const)(
    "tags a %s Backup with only its reason",
    async (tag) => {
      await target().backup(tag, running());

      const snapshots = JSON.parse(restic("snapshots", "--json")) as { tags?: string[] }[];
      expect(snapshots.map((snapshot) => snapshot.tags)).toEqual([[tag]]);
    },
  );

  it("fails without creating a repository that doesn't exist", async () => {
    const missing = join(dir, "missing");

    await expect(target({ repository: missing }).backup("change", running())).rejects.toThrow(
      "The restic repository does not exist",
    );
    expect(existsSync(missing)).toBe(false);
  });

  it.each([false, true])("checks the repository (reading a data subset: %s)", async (readDataSubset) => {
    await target().backup("nightly", running());

    await expect(target().check({ readDataSubset }, running())).resolves.toBeUndefined();
  });

  it("stops a Backup whose signal has aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Backup took longer than 5 minutes"));

    await expect(target().backup("change", controller.signal)).rejects.toThrow();
    expect(JSON.parse(restic("snapshots", "--json"))).toEqual([]);
  });
});

// A stand-in for restic that takes a moment to exit when killed, as restic
// does while it removes its lock from the repository.
describe("the restic Backup target, killed mid-run", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "private-profile-killed-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("settles only after a killed restic has exited", async () => {
    const restic = join(dir, "restic");
    writeFileSync(
      restic,
      [
        "#!/bin/sh",
        `trap 'kill $sleeper; sleep 0.3; touch "${dir}/exited"; exit 143' TERM`,
        `touch "${dir}/started"`,
        "sleep 30 &",
        "sleeper=$!",
        "wait $sleeper",
      ].join("\n"),
      { mode: 0o755 },
    );
    const target = resticBackupTarget({
      databasePath: join(dir, "profiles.db"),
      copyPath: join(dir, "data", "backup", "profiles.db"),
      repository: join(dir, "repository"),
      password: PASSWORD,
      r2: { accessKeyId: "unused-locally", secretAccessKey: "unused-locally" },
      cacheDir: join(dir, "cache"),
      restic,
    });
    const controller = new AbortController();

    const check = target.check({ readDataSubset: false }, controller.signal);
    await vi.waitFor(() => expect(existsSync(join(dir, "started"))).toBe(true));
    controller.abort(new Error("restic check took longer than 5 minutes"));

    await expect(check).rejects.toThrow();
    expect(existsSync(join(dir, "exited"))).toBe(true);
  });
});

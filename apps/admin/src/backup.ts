import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

/**
 * Why a Backup ran. restic stores tags unencrypted, so a tag never holds a
 * Profile Address or Label.
 */
export type BackupTag = "change" | "nightly" | "startup";

/** How thoroughly to check the repository. */
export interface CheckOptions {
  /** Also read a sample of the data, not only the structure. */
  readDataSubset: boolean;
}

/**
 * Where Backups go: a restic repository on R2. See docs/adr/0003. Each call
 * must stop and throw soon after its signal aborts.
 */
export interface BackupTarget {
  /** Takes one Backup of the Profile database. Throws if it failed. */
  backup(tag: BackupTag, signal: AbortSignal): Promise<void>;
  /** Checks the repository, reading a sample of the data if asked. Throws if it failed. */
  check(options: CheckOptions, signal: AbortSignal): Promise<void>;
}

/** Runs Backups one at a time and remembers how the latest one went. */
export interface BackupRunner {
  /** Takes a Backup. Never throws: a failure is logged and shows in `status`. */
  backUp(tag: BackupTag): Promise<void>;
  /**
   * Takes the nightly Backup, then checks the repository if it succeeded.
   * On the 1st of the month the check also reads a sample of the data.
   */
  nightly(): Promise<void>;
  /**
   * Whether the latest Backup or check failed, and when the last Backup
   * since start-up succeeded (null until one does).
   */
  readonly status: { backupFailed: boolean; lastSuccessfulBackupAt: Date | null };
}

/** One turn of the runner: a Backup, then a check if the nightly asked for one. */
interface Run {
  tag: BackupTag;
  check: CheckOptions | null;
}

/** A Backup or check that takes longer than this is killed and counts as failed. */
const TIME_LIMIT_MS = 5 * 60 * 1000;

// A follow-up run keeps the most telling tag of the requests it folds in.
const TAG_RANK: Record<BackupTag, number> = { change: 0, startup: 1, nightly: 2 };

function fold(pending: Run, request: Run): Run {
  const tag = TAG_RANK[request.tag] > TAG_RANK[pending.tag] ? request.tag : pending.tag;
  if (!pending.check && !request.check) return { tag, check: null };
  const readDataSubset = !!(pending.check?.readDataSubset || request.check?.readDataSubset);
  return { tag, check: { readDataSubset } };
}

export function createBackupRunner(target: BackupTarget, now: () => Date): BackupRunner {
  let backupFailed = false;
  let lastSuccessfulBackupAt: Date | null = null;

  // At most one run at a time, and at most one waiting. A request that
  // arrives while a run is going folds into the waiting one, which starts
  // after it, so it holds every change committed before it was requested.
  let running = false;
  let waiting: { run: Run; done: Promise<void>; finish: () => void } | null = null;

  /** Runs one step, recording whether it failed. Returns whether it succeeded. */
  async function step(what: string, task: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(new Error(`${what} took longer than ${TIME_LIMIT_MS / 60_000} minutes`)),
      TIME_LIMIT_MS,
    );
    try {
      await task(controller.signal);
      controller.signal.throwIfAborted();
      backupFailed = false;
      return true;
    } catch (error) {
      backupFailed = true;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      console.error(`${what} failed:`, reason instanceof Error ? reason.message : reason);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function execute({ tag, check }: Run) {
    if (!(await step("Backup", (signal) => target.backup(tag, signal)))) return;
    lastSuccessfulBackupAt = now();
    // A check after a failed Backup could clear the banner, so it waits for the next night.
    if (check) await step("restic check", (signal) => target.check(check, signal));
  }

  async function drain() {
    running = true;
    while (waiting) {
      const { run, finish } = waiting;
      waiting = null;
      await execute(run);
      finish();
    }
    running = false;
  }

  function request(run: Run) {
    if (waiting) {
      waiting.run = fold(waiting.run, run);
      return waiting.done;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting = { run, done: promise, finish: resolve };
    if (!running) void drain();
    return promise;
  }

  return {
    backUp: (tag) => request({ tag, check: null }),
    nightly: () => request({ tag: "nightly", check: { readDataSubset: now().getDate() === 1 } }),
    get status() {
      return { backupFailed, lastSuccessfulBackupAt };
    },
  };
}

// restic's documented exit codes worth a plain explanation.
const RESTIC_EXIT_REASONS: Record<number, string> = {
  10: "The restic repository does not exist. Create it with `restic init` (docs/deployment.md)",
  11: "The restic repository is locked",
  12: "The restic password is wrong",
};

/**
 * Backs up the Profile database with restic, which encrypts it before it
 * leaves the server. Each Backup first takes an online SQLite copy to
 * `copyPath`, so restic never reads a database mid-write. The repository
 * must already exist: this never runs `restic init`.
 */
export function resticBackupTarget(options: {
  databasePath: string;
  /** A fixed path, so every restic snapshot holds the same file. */
  copyPath: string;
  /** Such as `s3:https://<account id>.r2.cloudflarestorage.com/<bucket>`. */
  repository: string;
  password: string;
  /** An R2 API token's S3 key pair, scoped to the backup bucket. */
  r2: { accessKeyId: string; secretAccessKey: string };
  cacheDir: string;
  /** The restic binary. */
  restic?: string;
}): BackupTarget {
  // Only what restic needs: the secrets go to the child and nowhere else.
  const env = {
    PATH: process.env.PATH,
    RESTIC_REPOSITORY: options.repository,
    RESTIC_PASSWORD: options.password,
    AWS_ACCESS_KEY_ID: options.r2.accessKeyId,
    AWS_SECRET_ACCESS_KEY: options.r2.secretAccessKey,
  };

  function restic(args: string[], signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        options.restic ?? "restic",
        ["--quiet", "--cache-dir", options.cacheDir, ...args],
        { env, signal, stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      // An aborted signal kills restic and reports an error at once, but
      // restic still holds the repository lock until it exits. Settling
      // only on close keeps the next run from finding the lock.
      let failure: Error | undefined;
      child.on("error", (error) => {
        failure = error;
      });
      child.on("close", (code) => {
        if (failure) return reject(failure);
        if (code === 0) return resolve();
        const lastLine = stderr.trim().split("\n").at(-1) ?? "";
        const reason = (code !== null && RESTIC_EXIT_REASONS[code]) || `restic exited with ${code}`;
        reject(new Error(lastLine ? `${reason}: ${lastLine}` : reason));
      });
    });
  }

  return {
    async backup(tag, signal) {
      mkdirSync(dirname(options.copyPath), { recursive: true });
      const source = new DatabaseSync(options.databasePath, { readOnly: true });
      try {
        await backup(source, options.copyPath);
      } finally {
        source.close();
      }
      signal.throwIfAborted();
      await restic(["backup", "--tag", tag, "--host", "private-profile", options.copyPath], signal);
    },

    async check({ readDataSubset }, signal) {
      await restic(readDataSubset ? ["check", "--read-data-subset=10%"] : ["check"], signal);
    },
  };
}

import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { cloudflareAccessVerifier } from "./access.ts";
import { cloudflareKvTarget } from "./address-list.ts";
import { createApp } from "./app.ts";
import { resticBackupTarget } from "./backup.ts";
import { readConfig } from "./config.ts";
import { openProfileRegistry } from "./profile-registry.ts";
import { scheduleNightly } from "./schedule.ts";

const config = readConfig(process.env);
// Next to the database, so on the same volume.
const dataDir = dirname(config.databasePath);

const app = createApp({
  registry: openProfileRegistry(config.databasePath),
  profileDomain: config.profileDomain,
  addressList: cloudflareKvTarget(config.kv),
  accessVerifier: cloudflareAccessVerifier(config.access),
  // Generated Addresses must not be guessable, so use the CSPRNG.
  random: (maxExclusive) => randomInt(maxExclusive),
  now: () => new Date(),
  // createApp also reconciles and takes a Backup once on start-up.
  everyNight: scheduleNightly,
  backup: resticBackupTarget({
    ...config.backup,
    databasePath: config.databasePath,
    copyPath: join(dataDir, "backup", "profiles.db"),
    cacheDir: join(dataDir, "restic-cache"),
  }),
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Admin app listening on port ${port}`);
});

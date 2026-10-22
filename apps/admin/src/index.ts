import { randomInt } from "node:crypto";
import { serve } from "@hono/node-server";
import { cloudflareAccessVerifier } from "./access.ts";
import { cloudflareKvTarget } from "./address-list.ts";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { openProfileRegistry } from "./profile-registry.ts";

const config = readConfig(process.env);

const app = createApp({
  registry: openProfileRegistry(config.databasePath),
  profileDomain: config.profileDomain,
  addressList: cloudflareKvTarget(config.kv),
  accessVerifier: cloudflareAccessVerifier(config.access),
  // Generated Addresses must not be guessable, so use the CSPRNG.
  random: (maxExclusive) => randomInt(maxExclusive),
  now: () => new Date(),
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Admin app listening on port ${port}`);
});

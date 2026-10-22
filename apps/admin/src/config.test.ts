// Outside the agreed seams: start-up config isn't reachable through the
// admin HTTP API, and on the Pi the Cloudflare API token arrives as a file.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";

const ENV = {
  DATABASE_PATH: "/data/profiles.db",
  PROFILE_DOMAIN: "Profile.Example",
  ACCESS_TEAM_DOMAIN: "owner.cloudflareaccess.example",
  ACCESS_AUD: "app-aud-tag",
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  KV_NAMESPACE_ID: "namespace-id",
  CLOUDFLARE_API_TOKEN: "api-token-from-env",
};

function secretFile(contents: string) {
  const path = join(mkdtempSync(join(tmpdir(), "admin-config-")), "secret");
  writeFileSync(path, contents);
  return path;
}

describe("reading the admin app's config", () => {
  it("reads every setting from the environment", () => {
    const config = readConfig({ ...ENV, PORT: "9090" });

    expect(config).toEqual({
      port: 9090,
      databasePath: "/data/profiles.db",
      profileDomain: "profile.example",
      access: { teamDomain: "owner.cloudflareaccess.example", audience: "app-aud-tag" },
      kv: { accountId: "account-id", namespaceId: "namespace-id", apiToken: "api-token-from-env" },
    });
  });

  it("reads a setting from the file named by its _FILE variable", () => {
    const { CLOUDFLARE_API_TOKEN: _, ...env } = ENV;

    const config = readConfig({
      ...env,
      CLOUDFLARE_API_TOKEN_FILE: secretFile("api-token-from-file\n"),
    });

    expect(config.kv.apiToken).toBe("api-token-from-file");
  });

  it("refuses a setting given both directly and as a file", () => {
    expect(() =>
      readConfig({ ...ENV, CLOUDFLARE_API_TOKEN_FILE: secretFile("api-token-from-file") }),
    ).toThrow("Set only one of CLOUDFLARE_API_TOKEN and CLOUDFLARE_API_TOKEN_FILE");
  });

  it("names a missing setting without revealing any value", () => {
    const { CLOUDFLARE_API_TOKEN: _, ...env } = ENV;

    expect(() => readConfig(env)).toThrow("Missing environment variables: CLOUDFLARE_API_TOKEN");
  });

  it("names a setting whose file can't be read", () => {
    const { CLOUDFLARE_API_TOKEN: _, ...env } = ENV;

    expect(() =>
      readConfig({ ...env, CLOUDFLARE_API_TOKEN_FILE: "/run/secrets/does-not-exist" }),
    ).toThrow("Can't read CLOUDFLARE_API_TOKEN_FILE");
  });

  it("treats an empty secret file as missing", () => {
    const { CLOUDFLARE_API_TOKEN: _, ...env } = ENV;

    expect(() =>
      readConfig({ ...env, CLOUDFLARE_API_TOKEN_FILE: secretFile("\n") }),
    ).toThrow("Missing environment variables: CLOUDFLARE_API_TOKEN");
  });
});

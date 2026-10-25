import { readFileSync } from "node:fs";

export interface Config {
  port: number;
  databasePath: string;
  profileDomain: string;
  access: { teamDomain: string; audience: string };
  kv: { accountId: string; namespaceId: string; apiToken: string };
  backup: {
    repository: string;
    password: string;
    r2: { accessKeyId: string; secretAccessKey: string };
  };
}

/**
 * Reads the admin app's settings from the environment. Any setting can
 * instead come from the file named by `<NAME>_FILE`, such as a Docker
 * Compose secret. Values are never logged.
 */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const missing: string[] = [];
  const required = (name: string) => {
    const value = (readSettingFile(env, name) ?? env[name])?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };

  const config: Config = {
    port: Number(env.PORT ?? 8080),
    databasePath: required("DATABASE_PATH"),
    profileDomain: required("PROFILE_DOMAIN").toLowerCase(),
    access: {
      teamDomain: required("ACCESS_TEAM_DOMAIN"),
      audience: required("ACCESS_AUD"),
    },
    kv: {
      accountId: required("CLOUDFLARE_ACCOUNT_ID"),
      namespaceId: required("KV_NAMESPACE_ID"),
      apiToken: required("CLOUDFLARE_API_TOKEN"),
    },
    backup: {
      repository: required("RESTIC_REPOSITORY"),
      password: required("RESTIC_PASSWORD"),
      r2: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      },
    },
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error("PORT must be a port number");
  }
  return config;
}

/** The contents of the file named by `<name>_FILE`, or undefined if it isn't set. */
function readSettingFile(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const path = env[`${name}_FILE`]?.trim();
  if (!path) return undefined;
  if (env[name]?.trim()) {
    throw new Error(`Set only one of ${name} and ${name}_FILE`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`Can't read ${name}_FILE`);
  }
}

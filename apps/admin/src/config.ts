export interface Config {
  port: number;
  databasePath: string;
  profileDomain: string;
  access: { teamDomain: string; audience: string };
  kv: { accountId: string; namespaceId: string; apiToken: string };
}

/** Reads the admin app's settings from the environment. Values are never logged. */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const missing: string[] = [];
  const required = (name: string) => {
    const value = env[name]?.trim();
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
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error("PORT must be a port number");
  }
  return config;
}

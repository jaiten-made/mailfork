export interface Config {
  port: number;
  databasePath: string;
  profileDomain: string;
  accessTeamDomain: string;
  accessAudience: string;
  cloudflareAccountId: string;
  kvNamespaceId: string;
  cloudflareApiToken: string;
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
    accessTeamDomain: required("ACCESS_TEAM_DOMAIN"),
    accessAudience: required("ACCESS_AUD"),
    cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
    kvNamespaceId: required("KV_NAMESPACE_ID"),
    cloudflareApiToken: required("CLOUDFLARE_API_TOKEN"),
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error("PORT must be a port number");
  }
  return config;
}

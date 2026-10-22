import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** The header Cloudflare Access puts its signed JWT in on every proxied request. */
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

/** Checks a Cloudflare Access JWT against the Access signing keys and audience. */
export interface AccessVerifier {
  verify(token: string): Promise<boolean>;
}

export function createAccessVerifier(options: {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
}): AccessVerifier {
  return {
    async verify(token) {
      try {
        await jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Verifies against the Access team's published signing keys, such as
 * `owner.cloudflareaccess.com`, and the application's audience (AUD) tag.
 */
export function cloudflareAccessVerifier({
  teamDomain,
  audience,
}: {
  teamDomain: string;
  audience: string;
}): AccessVerifier {
  const issuer = `https://${teamDomain}`;
  return createAccessVerifier({
    issuer,
    audience,
    keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
  });
}

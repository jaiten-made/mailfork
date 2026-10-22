import { generateLocalPart, type RandomSource } from "@private-profile/shared";
import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ACCESS_JWT_HEADER, type AccessVerifier } from "./access.ts";
import type { AddressListTarget } from "./address-list.ts";
import type { ProfileRegistry } from "./profile-registry.ts";

export interface AppDeps {
  registry: ProfileRegistry;
  profileDomain: string;
  addressList: AddressListTarget;
  accessVerifier: AccessVerifier;
  random: RandomSource;
  now: () => Date;
}

const MAX_LABEL_LENGTH = 100;

/** The trimmed Label from a `{ "label": string }` body, or null if it is unusable. */
async function readLabel(c: Context): Promise<string | null> {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("label" in body)) return null;
  if (typeof body.label !== "string") return null;
  const label = body.label.trim();
  if (label === "" || label.length > MAX_LABEL_LENGTH) return null;
  return label;
}

const INVALID_LABEL = {
  error: `A Label must be 1 to ${MAX_LABEL_LENGTH} characters.`,
};

// The page is three small files, read once at start-up.
const PAGE_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
} as const;

function loadPageRoutes() {
  return Object.entries(PAGE_FILES).map(([path, [file, contentType]]) => ({
    path,
    contentType,
    body: readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"),
  }));
}

const NOT_FOUND = { error: "No such Profile." };

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const pageRoutes = loadPageRoutes();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );

  // Being reachable only through the tunnel isn't enough: every request,
  // including the page, needs a valid Access JWT.
  app.use(async (c, next) => {
    const token = c.req.header(ACCESS_JWT_HEADER);
    if (!token || !(await deps.accessVerifier.verify(token))) {
      return c.json({ error: "Sign in through Cloudflare Access." }, 401);
    }
    await next();
  });

  for (const { path, contentType, body } of pageRoutes) {
    app.get(path, (c) => c.body(body, 200, { "Content-Type": contentType }));
  }

  app.get("/api/profiles", (c) => c.json({ profiles: deps.registry.listLive() }));

  app.post("/api/profiles", async (c) => {
    const label = await readLabel(c);
    if (label === null) return c.json(INVALID_LABEL, 400);

    const profile = deps.registry.createWithGeneratedAddress(
      label,
      () => `${generateLocalPart(deps.random)}@${deps.profileDomain}`,
      deps.now(),
    );

    // The registry write has committed, so KV never holds an address the
    // registry lacks. A failed push is fixed by the next reconcile.
    try {
      await deps.addressList.put(profile.profileAddress, "live");
    } catch (error) {
      console.error("Address list push failed:", error instanceof Error ? error.message : error);
    }
    return c.json(profile, 201);
  });

  app.patch("/api/profiles/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id)) return c.json(NOT_FOUND, 404);
    const label = await readLabel(c);
    if (label === null) return c.json(INVALID_LABEL, 400);

    const profile = deps.registry.rename(id, label);
    return profile ? c.json(profile) : c.json(NOT_FOUND, 404);
  });

  return app;
}

import {
  checkCustomLocalPart,
  generateLocalPart,
  normaliseAddress,
  type RandomSource,
} from "@private-profile/shared";
import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ACCESS_JWT_HEADER, type AccessVerifier } from "./access.ts";
import type { AddressListTarget, AddressStatus } from "./address-list.ts";
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

/** The JSON object body, or null if there is none. */
async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  // Only application/json needs a CORS preflight, so this refuses a
  // cross-site form post that rides on the Access cookie.
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

/** A string field of a JSON object body, or null if it is missing. */
async function readJsonString(c: Context, field: string): Promise<string | null> {
  const value = (await readJsonObject(c))?.[field];
  return typeof value === "string" ? value : null;
}

/** The trimmed Label from a `{ "label": string }` body, or null if it is unusable. */
function readLabel(body: Record<string, unknown> | null): string | null {
  const label = body?.label;
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed === "" || trimmed.length > MAX_LABEL_LENGTH) return null;
  return trimmed;
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

const NOT_A_STRING = { error: "A Custom Address must be text." };

const ALREADY_ISSUED = { error: "That address was issued before." };

const NOT_FOUND = { error: "No such Profile." };

const ALREADY_RETIRED = { error: "This Profile is already Retired." };

const UNCONFIRMED_RETIRE = {
  error: "Type the full Profile Address to confirm the Retire.",
};

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const pageRoutes = loadPageRoutes();

  // Called once the registry write has committed, so KV never holds an
  // address or status the registry lacks. A failed push is fixed by the next
  // reconcile.
  async function publish(profileAddress: string, status: AddressStatus) {
    try {
      await deps.addressList.put(profileAddress, status);
    } catch (error) {
      console.error("Address list push failed:", error instanceof Error ? error.message : error);
    }
  }

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

  app.get("/api/profiles/retired", (c) => c.json({ profiles: deps.registry.listRetired() }));

  /**
   * The Profile Address a Custom Address local part would get, or the
   * reason it can't be issued. Uniqueness ignores case because Profile
   * Addresses are stored normalised.
   */
  function checkCustomAddress(raw: string) {
    const check = checkCustomLocalPart(raw);
    if (!check.valid) return { refusal: { error: check.reason }, status: 400 } as const;
    const profileAddress = `${check.localPart}@${deps.profileDomain}`;
    if (deps.registry.wasIssued(profileAddress)) {
      return { refusal: ALREADY_ISSUED, status: 409 } as const;
    }
    return { profileAddress };
  }

  app.post("/api/custom-addresses/check", async (c) => {
    const raw = await readJsonString(c, "customLocalPart");
    if (raw === null) return c.json(NOT_A_STRING, 400);
    const checked = checkCustomAddress(raw);
    if (checked.refusal) return c.json(checked.refusal, checked.status);
    return c.json({ profileAddress: checked.profileAddress });
  });

  app.post("/api/profiles", async (c) => {
    const body = await readJsonObject(c);
    const label = readLabel(body);
    if (label === null) return c.json(INVALID_LABEL, 400);

    // A missing or blank Custom Address means the default, a Generated Address.
    const customLocalPart = body?.customLocalPart;
    if (customLocalPart !== undefined && typeof customLocalPart !== "string") {
      return c.json(NOT_A_STRING, 400);
    }
    if (customLocalPart === undefined || customLocalPart.trim() === "") {
      const profile = deps.registry.createWithGeneratedAddress(
        label,
        () => `${generateLocalPart(deps.random)}@${deps.profileDomain}`,
        deps.now(),
      );
      await publish(profile.profileAddress, "live");
      return c.json(profile, 201);
    }

    const checked = checkCustomAddress(customLocalPart);
    if (checked.refusal) return c.json(checked.refusal, checked.status);
    // The insert itself refuses an address issued since the check.
    const profile = deps.registry.createWithCustomAddress(
      label,
      checked.profileAddress,
      deps.now(),
    );
    if (!profile) return c.json(ALREADY_ISSUED, 409);
    await publish(profile.profileAddress, "live");
    return c.json(profile, 201);
  });

  app.patch("/api/profiles/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id)) return c.json(NOT_FOUND, 404);
    const label = readLabel(await readJsonObject(c));
    if (label === null) return c.json(INVALID_LABEL, 400);

    // Retire is final, Label included.
    if (deps.registry.find(id)?.retiredAt) {
      return c.json({ error: "A Retired Profile can't be renamed." }, 409);
    }
    const profile = deps.registry.rename(id, label);
    return profile ? c.json(profile) : c.json(NOT_FOUND, 404);
  });

  app.post("/api/profiles/:id/retire", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id)) return c.json(NOT_FOUND, 404);
    const confirmation = await readJsonString(c, "confirmation");
    const found = deps.registry.find(id);
    if (!found) return c.json(NOT_FOUND, 404);
    // Profile Addresses are stored normalised, so this needs the whole
    // address, domain included, in any case.
    if (confirmation === null || normaliseAddress(confirmation)?.address !== found.profileAddress) {
      return c.json(UNCONFIRMED_RETIRE, 400);
    }

    // Rows are never deleted, so no Profile here means it was Retired before.
    const profile = deps.registry.retire(id, deps.now());
    if (!profile) return c.json(ALREADY_RETIRED, 409);
    await publish(profile.profileAddress, "retired");
    return c.json(profile);
  });

  return app;
}

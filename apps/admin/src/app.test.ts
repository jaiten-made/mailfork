import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createAccessVerifier, type AccessVerifier } from "./access.ts";
import type { AddressListTarget, AddressStatus } from "./address-list.ts";
import { openProfileRegistry } from "./profile-registry.ts";

const VALID_ACCESS_JWT = "valid-access-jwt";
const CREATED_AT = "2026-10-22T09:30:00.000Z";

// Indexes into the bundled wordlists, so `random: [QUIET, OTTER, 42]` reads
// as the Generated Address it scripts.
const QUIET = 47;
const FADED = 17;
const OTTER = 38;
const FOX = 19;

const fakeAccessVerifier: AccessVerifier = {
  async verify(token) {
    return token === VALID_ACCESS_JWT;
  },
};

/** A seeded random source: returns the scripted numbers in order. */
function scriptedRandom(numbers: number[]) {
  const queue = [...numbers];
  return (maxExclusive: number) => {
    const next = queue.shift();
    if (next === undefined) throw new Error("Scripted random source ran out");
    if (next >= maxExclusive) throw new Error(`${next} is not below ${maxExclusive}`);
    return next;
  };
}

interface Put {
  key: string;
  value: AddressStatus;
}

function recordingKv(onPut?: (put: Put) => Promise<void>) {
  const puts: Put[] = [];
  const target: AddressListTarget = {
    async put(key, value) {
      await onPut?.({ key, value });
      puts.push({ key, value });
    },
  };
  return { target, puts };
}

function startAdmin({
  random = [QUIET, OTTER, 42],
  addressList = recordingKv().target,
  accessVerifier = fakeAccessVerifier,
}: {
  random?: number[];
  addressList?: AddressListTarget;
  accessVerifier?: AccessVerifier;
} = {}) {
  let now = new Date(CREATED_AT);
  const app = createApp({
    registry: openProfileRegistry(":memory:"),
    profileDomain: "profile.example",
    addressList,
    accessVerifier,
    random: scriptedRandom(random),
    now: () => now,
  });

  function request(
    path: string,
    init: RequestInit & { accessJwt?: string | null } = {},
  ) {
    const { accessJwt = VALID_ACCESS_JWT, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (accessJwt !== null) headers.set("Cf-Access-Jwt-Assertion", accessJwt);
    if (rest.body !== undefined) headers.set("Content-Type", "application/json");
    return app.request(path, { ...rest, headers });
  }

  const create = (label: string) =>
    request("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ label }),
    });

  return {
    request,
    create,
    /** Creates a Profile and returns its JSON. */
    createProfile: async (label: string) =>
      (await (await create(label)).json()) as { id: number },
    setTime: (iso: string) => {
      now = new Date(iso);
    },
    list: async () => (await request("/api/profiles")).json(),
    rename: (id: unknown, label: string) =>
      request(`/api/profiles/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ label }),
      }),
  };
}

describe("creating a Profile", () => {
  it("gives a Profile created with only a Label a Generated Address on the Profile Domain", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });

    const response = await admin.create("Shopping");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(Number),
      label: "Shopping",
      profileAddress: "quiet.otter.42@profile.example",
      createdAt: CREATED_AT,
    });
  });

  it("retries generation when the Generated Address was issued before", async () => {
    const admin = startAdmin({
      random: [QUIET, OTTER, 42, QUIET, OTTER, 42, FADED, FOX, 7],
    });
    await admin.create("Shopping");

    const response = await admin.create("Travel");

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      label: "Travel",
      profileAddress: "faded.fox.07@profile.example",
    });
  });
});

describe("validating the Label", () => {
  it.each(["", "   "])("refuses to create a Profile with the blank Label %j", async (label) => {
    const admin = startAdmin();

    const response = await admin.create(label);

    expect(response.status).toBe(400);
    expect(await admin.list()).toEqual({ profiles: [] });
  });

  it("refuses a Label longer than 100 characters", async () => {
    const admin = startAdmin();

    const response = await admin.create("x".repeat(101));

    expect(response.status).toBe(400);
  });

  it("trims the Label", async () => {
    const admin = startAdmin();

    const response = await admin.create("  Shopping  ");

    expect(await response.json()).toMatchObject({ label: "Shopping" });
  });

  it("refuses a request whose body is not JSON with a Label", async () => {
    const admin = startAdmin();

    const response = await admin.request("/api/profiles", {
      method: "POST",
      body: "label=Shopping",
    });

    expect(response.status).toBe(400);
  });
});

describe("giving up on generation", () => {
  it("fails without a Profile or a push when every Generated Address tried was issued before", async () => {
    const kv = recordingKv();
    const admin = startAdmin({
      random: Array.from({ length: 11 }, () => [QUIET, OTTER, 42]).flat(),
      addressList: kv.target,
    });
    await admin.create("Shopping");

    const response = await admin.create("Travel");

    expect(response.status).toBe(500);
    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
    expect(kv.puts).toEqual([{ key: "quiet.otter.42@profile.example", value: "live" }]);
  });
});

describe("listing Profiles", () => {
  it("lists live Profiles, newest first, with Label, Profile Address and created-at", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42, FADED, FOX, 7] });
    admin.setTime("2026-10-20T08:00:00.000Z");
    await admin.create("Shopping");
    admin.setTime("2026-10-21T19:45:00.000Z");
    await admin.create("Dating");

    expect(await admin.list()).toEqual({
      profiles: [
        {
          id: expect.any(Number),
          label: "Dating",
          profileAddress: "faded.fox.07@profile.example",
          createdAt: "2026-10-21T19:45:00.000Z",
        },
        {
          id: expect.any(Number),
          label: "Shopping",
          profileAddress: "quiet.otter.42@profile.example",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
      ],
    });
  });

  it("lists nothing before the first Profile is created", async () => {
    const admin = startAdmin();

    expect(await admin.list()).toEqual({ profiles: [] });
  });
});

describe("publishing the address list", () => {
  it("pushes a new Profile Address to KV as live", async () => {
    const kv = recordingKv();
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: kv.target,
    });

    await admin.create("Shopping");

    expect(kv.puts).toEqual([
      { key: "quiet.otter.42@profile.example", value: "live" },
    ]);
  });

  it("pushes only after the registry write has committed", async () => {
    const listedAtPush: unknown[] = [];
    const kv = recordingKv(async () => {
      listedAtPush.push(await admin.list());
    });
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: kv.target,
    });

    await admin.create("Shopping");

    expect(listedAtPush).toEqual([
      {
        profiles: [
          {
            id: expect.any(Number),
            label: "Shopping",
            profileAddress: "quiet.otter.42@profile.example",
            createdAt: CREATED_AT,
          },
        ],
      },
    ]);
  });

  it("does not push when the request is rejected", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ addressList: kv.target });

    await admin.create("   ");

    expect(kv.puts).toEqual([]);
  });

  it("keeps the new Profile when the push fails", async () => {
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: {
        async put() {
          throw new Error("Cloudflare API unreachable");
        },
      },
    });

    const response = await admin.create("Shopping");

    expect(response.status).toBe(201);
    expect(await admin.list()).toMatchObject({
      profiles: [{ profileAddress: "quiet.otter.42@profile.example" }],
    });
  });
});

describe("renaming a Profile", () => {
  it("changes only the Label, never the Profile Address", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });
    const created = await admin.createProfile("Shoping");

    const response = await admin.rename(created.id, "Shopping");

    expect(response.status).toBe(200);
    const expected = {
      id: created.id,
      label: "Shopping",
      profileAddress: "quiet.otter.42@profile.example",
      createdAt: CREATED_AT,
    };
    expect(await response.json()).toEqual(expected);
    expect(await admin.list()).toEqual({ profiles: [expected] });
  });

  it("does not push to KV, since the Profile Address is unchanged", async () => {
    const kv = recordingKv();
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: kv.target,
    });
    const created = await admin.createProfile("Shoping");

    await admin.rename(created.id, "Shopping");

    expect(kv.puts).toEqual([
      { key: "quiet.otter.42@profile.example", value: "live" },
    ]);
  });

  it("refuses a blank Label and keeps the old one", async () => {
    const admin = startAdmin();
    const created = await admin.createProfile("Shopping");

    const response = await admin.rename(created.id, " ");

    expect(response.status).toBe(400);
    expect(await admin.list()).toMatchObject({
      profiles: [{ label: "Shopping" }],
    });
  });

  it.each([999, "not-a-number"])("answers 404 for the unknown Profile id %j", async (id) => {
    const admin = startAdmin();

    const response = await admin.rename(id, "Shopping");

    expect(response.status).toBe(404);
  });
});

describe("the page", () => {
  it("serves a phone-sized page that warns a new address can take up to a minute", async () => {
    const admin = startAdmin();

    const response = await admin.request("/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(html).toContain("A new address can take up to a minute to start working.");
  });

  it.each([
    ["/style.css", "text/css; charset=utf-8"],
    ["/app.js", "text/javascript; charset=utf-8"],
  ])("serves %s", async (path, contentType) => {
    const admin = startAdmin();

    const response = await admin.request(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
  });
});

describe("requiring a Cloudflare Access JWT", () => {
  const requests: [string, RequestInit][] = [
    ["/api/profiles", { method: "GET" }],
    ["/api/profiles", { method: "POST", body: JSON.stringify({ label: "Shopping" }) }],
    ["/api/profiles/1", { method: "PATCH", body: JSON.stringify({ label: "Shopping" }) }],
    ["/", { method: "GET" }],
    ["/no-such-page", { method: "GET" }],
  ];

  it.each(requests)("rejects %s without an Access JWT", async (path, init) => {
    const admin = startAdmin();

    const response = await admin.request(path, { ...init, accessJwt: null });

    expect(response.status).toBe(401);
  });

  it.each(requests)("rejects %s with an invalid Access JWT", async (path, init) => {
    const admin = startAdmin();

    const response = await admin.request(path, { ...init, accessJwt: "forged-access-jwt" });

    expect(response.status).toBe(401);
  });

  it("neither creates a Profile nor pushes to KV for a rejected request", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ addressList: kv.target });

    await admin.request("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ label: "Shopping" }),
      accessJwt: "forged-access-jwt",
    });

    expect(await admin.list()).toEqual({ profiles: [] });
    expect(kv.puts).toEqual([]);
  });

  it("does not rename a Profile for a rejected request", async () => {
    const admin = startAdmin();
    const created = await admin.createProfile("Shopping");

    await admin.request(`/api/profiles/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Dating" }),
      accessJwt: null,
    });

    expect(await admin.list()).toMatchObject({
      profiles: [{ label: "Shopping" }],
    });
  });
});

// The fake verifier above can't catch a misconfigured issuer, audience or
// key check, so the real verifier gets its own tests against a local key set.
describe("verifying Cloudflare Access JWTs", () => {
  const ISSUER = "https://owner.cloudflareaccess.example";
  const AUDIENCE = "admin-app-aud-tag";

  async function accessKeys() {
    const access = await generateKeyPair("RS256");
    const impostor = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(access.publicKey)), kid: "access", alg: "RS256" };
    const verifier = createAccessVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: createLocalJWKSet({ keys: [jwk] }),
    });
    const sign = (
      key: Parameters<SignJWT["sign"]>[0],
      claims: { iss?: string; aud?: string; exp?: Date } = {},
    ) =>
      new SignJWT({ email: "owner@personal.example" })
        .setProtectedHeader({ alg: "RS256", kid: "access" })
        .setIssuer(claims.iss ?? ISSUER)
        .setAudience(claims.aud ?? AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? "5m")
        .sign(key);
    return { verifier, access: access.privateKey, impostor: impostor.privateKey, sign };
  }

  it("accepts a JWT signed by Access for this application", async () => {
    const keys = await accessKeys();
    const admin = startAdmin({ accessVerifier: keys.verifier });

    const response = await admin.request("/api/profiles", {
      accessJwt: await keys.sign(keys.access),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a JWT for another application's audience", async () => {
    const keys = await accessKeys();
    const admin = startAdmin({ accessVerifier: keys.verifier });

    const response = await admin.request("/api/profiles", {
      accessJwt: await keys.sign(keys.access, { aud: "other-app-aud-tag" }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a JWT from another issuer", async () => {
    const keys = await accessKeys();
    const admin = startAdmin({ accessVerifier: keys.verifier });

    const response = await admin.request("/api/profiles", {
      accessJwt: await keys.sign(keys.access, { iss: "https://intruder.cloudflareaccess.example" }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a JWT not signed with an Access signing key", async () => {
    const keys = await accessKeys();
    const admin = startAdmin({ accessVerifier: keys.verifier });

    const response = await admin.request("/api/profiles", {
      accessJwt: await keys.sign(keys.impostor),
    });

    expect(response.status).toBe(401);
  });

  it("rejects an expired JWT", async () => {
    const keys = await accessKeys();
    const admin = startAdmin({ accessVerifier: keys.verifier });

    const response = await admin.request("/api/profiles", {
      accessJwt: await keys.sign(keys.access, { exp: new Date("2020-01-01T00:00:00Z") }),
    });

    expect(response.status).toBe(401);
  });
});

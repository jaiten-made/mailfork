import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createAccessVerifier, type AccessVerifier } from "./access.ts";
import type { AddressListTarget, AddressStatus } from "./address-list.ts";
import { openProfileRegistry } from "./profile-registry.ts";

const VALID_ACCESS_JWT = "valid-access-jwt";
const CREATED_AT = "2026-10-22T09:30:00.000Z";
const RETIRED_AT = "2026-10-23T14:05:00.000Z";

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
    if (rest.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return app.request(path, { ...rest, headers });
  }

  const create = (label: string, customLocalPart?: unknown) =>
    request("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ label, customLocalPart }),
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
    retire: (id: unknown, confirmation: unknown) =>
      request(`/api/profiles/${id}/retire`, {
        method: "POST",
        body: JSON.stringify({ confirmation }),
      }),
    listRetired: async () => (await request("/api/profiles/retired")).json(),
    checkCustomAddress: (customLocalPart: unknown) =>
      request("/api/custom-addresses/check", {
        method: "POST",
        body: JSON.stringify({ customLocalPart }),
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

  // A cross-site form can send text/plain without a CORS preflight, so a
  // JSON body under any other Content-Type must not create a Profile.
  it("refuses a JSON body that is not sent as application/json", async () => {
    const admin = startAdmin();

    const response = await admin.request("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ label: "Shopping" }),
    });

    expect(response.status).toBe(400);
    expect(await admin.list()).toEqual({ profiles: [] });
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

describe("creating a Profile with a Custom Address", () => {
  it("gives the Profile exactly the Custom Address chosen, on the Profile Domain", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [], addressList: kv.target });

    const response = await admin.create("Shopping", "shop.2026");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(Number),
      label: "Shopping",
      profileAddress: "shop.2026@profile.example",
      createdAt: CREATED_AT,
    });
    expect(kv.puts).toEqual([{ key: "shop.2026@profile.example", value: "live" }]);
  });

  it("normalises a Custom Address to lowercase", async () => {
    const admin = startAdmin({ random: [] });

    const response = await admin.create("Shopping", "  Shop-Front.NZ ");

    expect(await response.json()).toMatchObject({
      profileAddress: "shop-front.nz@profile.example",
    });
  });

  it.each(["abc", "a".repeat(32), "a.b-c", "0-9"])(
    "accepts the Custom Address %j at the edges of the rules",
    async (customLocalPart) => {
      const admin = startAdmin({ random: [] });

      const response = await admin.create("Shopping", customLocalPart);

      expect(response.status).toBe(201);
    },
  );

  it("gives a Generated Address when the Custom Address is left blank", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });

    const response = await admin.create("Shopping", "  ");

    expect(await response.json()).toMatchObject({
      profileAddress: "quiet.otter.42@profile.example",
    });
  });

  it("refuses a Custom Address that is not a string", async () => {
    const admin = startAdmin({ random: [] });

    const response = await admin.create("Shopping", 42);

    expect(response.status).toBe(400);
    expect(await admin.list()).toEqual({ profiles: [] });
  });

  it.each([
    ["shop_front", "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["shop front", "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["shop+tag", "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["shop@profile.example", "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["caf\u00e9", "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["ab", "A Custom Address must be 3 to 32 characters long."],
    ["a".repeat(33), "A Custom Address must be 3 to 32 characters long."],
    [".shop", "A Custom Address can't start or end with a dot or a hyphen."],
    ["shop.", "A Custom Address can't start or end with a dot or a hyphen."],
    ["-shop", "A Custom Address can't start or end with a dot or a hyphen."],
    ["shop-", "A Custom Address can't start or end with a dot or a hyphen."],
    ["shop..front", "A Custom Address can't have two dots or hyphens in a row."],
    ["shop--front", "A Custom Address can't have two dots or hyphens in a row."],
    ["shop.-front", "A Custom Address can't have two dots or hyphens in a row."],
    ["shop-.front", "A Custom Address can't have two dots or hyphens in a row."],
  ])("refuses the Custom Address %j with a clear reason", async (customLocalPart, error) => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [], addressList: kv.target });

    const response = await admin.create("Shopping", customLocalPart);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await admin.list()).toEqual({ profiles: [] });
    expect(kv.puts).toEqual([]);
  });

  it.each(["postmaster", "abuse", "admin", "noreply", "reply", "PostMaster", "NoReply"])(
    "refuses the reserved name %j",
    async (customLocalPart) => {
      const kv = recordingKv();
      const admin = startAdmin({ random: [], addressList: kv.target });

      const response = await admin.create("Shopping", customLocalPart);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "That address is reserved for the Profile Domain.",
      });
      expect(await admin.list()).toEqual({ profiles: [] });
      expect(kv.puts).toEqual([]);
    },
  );

  it.each(["shop.2026", "SHOP.2026", "Shop.2026"])(
    "refuses %j while a live Profile has shop.2026",
    async (customLocalPart) => {
      const kv = recordingKv();
      const admin = startAdmin({ random: [], addressList: kv.target });
      await admin.create("Shopping", "shop.2026");

      const response = await admin.create("Travel", customLocalPart);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "That address was issued before." });
      expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
      expect(kv.puts).toEqual([{ key: "shop.2026@profile.example", value: "live" }]);
    },
  );

  it.each(["faded.fox.07", "FADED.FOX.07", "Faded.Fox.07"])(
    "refuses %j once faded.fox.07 is a Retired Address",
    async (customLocalPart) => {
      const admin = startAdmin({ random: [FADED, FOX, 7] });
      const dating = await admin.createProfile("Dating");
      await admin.retire(dating.id, "faded.fox.07@profile.example");

      const response = await admin.create("Travel", customLocalPart);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "That address was issued before." });
      expect(await admin.list()).toEqual({ profiles: [] });
    },
  );

  it("never issues a Custom Address as a Generated Address: a seeded source that regenerates it causes a retry", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42, FADED, FOX, 7] });
    await admin.create("Shopping", "quiet.otter.42");

    const response = await admin.create("Travel");

    expect(await response.json()).toMatchObject({
      profileAddress: "faded.fox.07@profile.example",
    });
  });

  it("checks the Label before the Custom Address", async () => {
    const admin = startAdmin({ random: [] });

    const response = await admin.create("", "postmaster");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A Label must be 1 to 100 characters." });
  });
});

// The page calls this as the Owner types, so it shows a bad or taken address
// before the form is submitted.
describe("checking a Custom Address before creating", () => {
  it("answers with the Profile Address a valid, unissued Custom Address would get", async () => {
    const admin = startAdmin({ random: [] });

    const response = await admin.checkCustomAddress(" Shop.2026 ");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileAddress: "shop.2026@profile.example" });
  });

  it.each([
    ["shop_front", 400, "A Custom Address can only use the letters a to z, digits, dots and hyphens."],
    ["ab", 400, "A Custom Address must be 3 to 32 characters long."],
    ["shop.", 400, "A Custom Address can't start or end with a dot or a hyphen."],
    ["shop..front", 400, "A Custom Address can't have two dots or hyphens in a row."],
    ["Abuse", 400, "That address is reserved for the Profile Domain."],
    ["", 400, "A Custom Address must be 3 to 32 characters long."],
  ])("refuses %j with the reason create would give", async (customLocalPart, status, error) => {
    const admin = startAdmin({ random: [] });

    const response = await admin.checkCustomAddress(customLocalPart);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("refuses a Custom Address issued to a live or Retired Profile, in any case", async () => {
    const admin = startAdmin({ random: [FADED, FOX, 7] });
    await admin.create("Shopping", "shop.2026");
    const dating = await admin.createProfile("Dating");
    await admin.retire(dating.id, "faded.fox.07@profile.example");

    for (const customLocalPart of ["SHOP.2026", "Faded.Fox.07"]) {
      const response = await admin.checkCustomAddress(customLocalPart);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "That address was issued before." });
    }
  });

  it("neither creates a Profile nor pushes to KV", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [], addressList: kv.target });

    await admin.checkCustomAddress("shop.2026");

    expect(await admin.list()).toEqual({ profiles: [] });
    expect(kv.puts).toEqual([]);
  });

  it("refuses a check that is not sent as application/json", async () => {
    const admin = startAdmin({ random: [] });

    const response = await admin.request("/api/custom-addresses/check", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ customLocalPart: "shop.2026" }),
    });

    expect(response.status).toBe(400);
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

  it("lists Retired Profiles separately, most recently Retired first, with created-at and retired-at", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42, FADED, FOX, 7, QUIET, FOX, 1] });
    admin.setTime("2026-10-20T08:00:00.000Z");
    const shopping = await admin.createProfile("Shopping");
    admin.setTime("2026-10-21T19:45:00.000Z");
    const dating = await admin.createProfile("Dating");
    await admin.createProfile("Travel");
    admin.setTime("2026-10-22T07:10:00.000Z");
    await admin.retire(dating.id, "faded.fox.07@profile.example");
    admin.setTime("2026-10-23T14:05:00.000Z");
    await admin.retire(shopping.id, "quiet.otter.42@profile.example");

    expect(await admin.listRetired()).toEqual({
      profiles: [
        {
          id: shopping.id,
          label: "Shopping",
          profileAddress: "quiet.otter.42@profile.example",
          createdAt: "2026-10-20T08:00:00.000Z",
          retiredAt: "2026-10-23T14:05:00.000Z",
        },
        {
          id: dating.id,
          label: "Dating",
          profileAddress: "faded.fox.07@profile.example",
          createdAt: "2026-10-21T19:45:00.000Z",
          retiredAt: "2026-10-22T07:10:00.000Z",
        },
      ],
    });
    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Travel" }] });
  });

  it("lists no Retired Profiles before the first Retire", async () => {
    const admin = startAdmin();
    await admin.createProfile("Shopping");

    expect(await admin.listRetired()).toEqual({ profiles: [] });
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

  it("pushes a Retired Address to KV as retired", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");

    await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(kv.puts).toEqual([
      { key: "quiet.otter.42@profile.example", value: "live" },
      { key: "quiet.otter.42@profile.example", value: "retired" },
    ]);
  });

  it("pushes a Retired Address only after the Retire has committed", async () => {
    const liveAtPush: unknown[] = [];
    const kv = recordingKv(async ({ value }) => {
      if (value === "retired") liveAtPush.push(await admin.list());
    });
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");

    await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(liveAtPush).toEqual([{ profiles: [] }]);
  });

  it("keeps the Retire when the push fails", async () => {
    let failPuts = false;
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: {
        async put() {
          if (failPuts) throw new Error("Cloudflare API unreachable");
        },
      },
    });
    const created = await admin.createProfile("Shopping");
    failPuts = true;

    const response = await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(response.status).toBe(200);
    expect(await admin.list()).toEqual({ profiles: [] });
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

describe("retiring a Profile", () => {
  it("Retires a Profile when the confirmation is its full Profile Address", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });
    const created = await admin.createProfile("Shopping");
    admin.setTime(RETIRED_AT);

    const response = await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: created.id,
      label: "Shopping",
      profileAddress: "quiet.otter.42@profile.example",
      createdAt: CREATED_AT,
      retiredAt: RETIRED_AT,
    });
    expect(await admin.list()).toEqual({ profiles: [] });
  });

  it.each([
    ["only the local part", "quiet.otter.42"],
    ["another Profile Address", "faded.fox.07@profile.example"],
    ["the address on another domain", "quiet.otter.42@other.example"],
    ["nothing", ""],
    ["a non-string", 42],
    ["no confirmation", undefined],
  ])("refuses to Retire when the confirmation is %s", async (_, confirmation) => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");

    const response = await admin.retire(created.id, confirmation);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Type the full Profile Address to confirm the Retire.",
    });
    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
    expect(kv.puts).toEqual([{ key: "quiet.otter.42@profile.example", value: "live" }]);
  });

  it("accepts a confirmation that differs only in case and surrounding spaces", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });
    const created = await admin.createProfile("Shopping");

    const response = await admin.retire(created.id, "  Quiet.Otter.42@Profile.Example ");

    expect(response.status).toBe(200);
    expect(await admin.list()).toEqual({ profiles: [] });
  });

  it.each([999, "not-a-number"])("answers 404 for the unknown Profile id %j", async (id) => {
    const admin = startAdmin();

    const response = await admin.retire(id, "quiet.otter.42@profile.example");

    expect(response.status).toBe(404);
  });

  it("refuses to Retire a Profile that is already Retired, keeping its retired-at", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");
    admin.setTime(RETIRED_AT);
    await admin.retire(created.id, "quiet.otter.42@profile.example");
    admin.setTime("2026-10-24T10:00:00.000Z");

    const response = await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This Profile is already Retired." });
    expect(await admin.listRetired()).toMatchObject({ profiles: [{ retiredAt: RETIRED_AT }] });
    expect(kv.puts).toHaveLength(2);
  });

  it("refuses a confirmation that is not sent as application/json", async () => {
    const admin = startAdmin({ random: [QUIET, OTTER, 42] });
    const created = await admin.createProfile("Shopping");

    const response = await admin.request(`/api/profiles/${created.id}/retire`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ confirmation: "quiet.otter.42@profile.example" }),
    });

    expect(response.status).toBe(400);
    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
  });
});

describe("Retire is final", () => {
  async function retiredShopping() {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");
    admin.setTime(RETIRED_AT);
    await admin.retire(created.id, "quiet.otter.42@profile.example");
    return { admin, kv, id: created.id };
  }

  it.each([
    ["POST", "reinstate", undefined],
    ["POST", "unretire", undefined],
    ["DELETE", "retire", undefined],
    ["PATCH", "", JSON.stringify({ retiredAt: null })],
    ["PUT", "", JSON.stringify({ retiredAt: null })],
  ])("offers no way to reinstate a Retired Profile: %s /api/profiles/:id/%s", async (method, action, body) => {
    const { admin, kv, id } = await retiredShopping();

    const response = await admin.request(`/api/profiles/${id}${action ? `/${action}` : ""}`, {
      method,
      body,
    });

    expect(response.ok).toBe(false);
    expect(await admin.list()).toEqual({ profiles: [] });
    expect(await admin.listRetired()).toMatchObject({
      profiles: [{ profileAddress: "quiet.otter.42@profile.example", retiredAt: RETIRED_AT }],
    });
    expect(kv.puts.at(-1)).toEqual({ key: "quiet.otter.42@profile.example", value: "retired" });
  });

  it("refuses to rename a Retired Profile", async () => {
    const { admin, id } = await retiredShopping();

    const response = await admin.rename(id, "Old shopping");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A Retired Profile can't be renamed." });
    expect(await admin.listRetired()).toMatchObject({ profiles: [{ label: "Shopping" }] });
  });

  it("never issues a Retired Address again: a seeded source that regenerates it causes a retry", async () => {
    const kv = recordingKv();
    const admin = startAdmin({
      random: [QUIET, OTTER, 42, QUIET, OTTER, 42, FADED, FOX, 7],
      addressList: kv.target,
    });
    const shopping = await admin.createProfile("Shopping");
    await admin.retire(shopping.id, "quiet.otter.42@profile.example");

    const response = await admin.create("Travel");

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      label: "Travel",
      profileAddress: "faded.fox.07@profile.example",
    });
    expect(kv.puts).toEqual([
      { key: "quiet.otter.42@profile.example", value: "live" },
      { key: "quiet.otter.42@profile.example", value: "retired" },
      { key: "faded.fox.07@profile.example", value: "live" },
    ]);
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

  it("warns after a Retire that a Retired Address can take up to a minute to stop working", async () => {
    const admin = startAdmin();

    const html = await (await admin.request("/")).text();

    expect(html).toContain("A Retired Address can take up to a minute to stop working.");
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
    ["/api/profiles/retired", { method: "GET" }],
    [
      "/api/profiles/1/retire",
      { method: "POST", body: JSON.stringify({ confirmation: "quiet.otter.42@profile.example" }) },
    ],
    [
      "/api/custom-addresses/check",
      { method: "POST", body: JSON.stringify({ customLocalPart: "shop.2026" }) },
    ],
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

  it("does not Retire a Profile for a rejected request", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");

    await admin.request(`/api/profiles/${created.id}/retire`, {
      method: "POST",
      body: JSON.stringify({ confirmation: "quiet.otter.42@profile.example" }),
      accessJwt: "forged-access-jwt",
    });

    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
    expect(kv.puts).toEqual([{ key: "quiet.otter.42@profile.example", value: "live" }]);
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

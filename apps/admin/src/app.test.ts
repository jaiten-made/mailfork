import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { createAccessVerifier, type AccessVerifier } from "./access.ts";
import type { AddressListTarget, AddressStatus } from "./address-list.ts";
import type { BackupTag, BackupTarget } from "./backup.ts";
import { openProfileRegistry, type ProfileRegistry } from "./profile-registry.ts";
import { scheduleNightly } from "./schedule.ts";

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

/**
 * A fake KV namespace that records puts and deletes. While `fail()` is on,
 * every call throws, as when the Cloudflare API is unreachable.
 */
function recordingKv(
  onPut?: (put: Put) => Promise<void>,
  initial: Record<string, AddressStatus> = {},
) {
  const puts: Put[] = [];
  const deletes: string[] = [];
  const entries = new Map(Object.entries(initial));
  let failing = false;
  const unreachable = () => {
    if (failing) throw new Error("Cloudflare API unreachable");
  };
  const target: AddressListTarget = {
    async put(key, value) {
      unreachable();
      await onPut?.({ key, value });
      puts.push({ key, value });
      entries.set(key, value);
    },
    async delete(key) {
      unreachable();
      deletes.push(key);
      entries.delete(key);
    },
    async keys() {
      unreachable();
      return [...entries.keys()];
    },
  };
  return {
    target,
    puts,
    deletes,
    /** Every key and value now in the namespace. */
    contents: () => Object.fromEntries(entries),
    fail: (on = true) => {
      failing = on;
    },
  };
}

/**
 * A fake Backup target that records the tag of each Backup and each check.
 * `onBackup` runs at the start of a Backup, so a test can hold it open or
 * look at the registry. While `fail()` is on, Backups and checks throw, as
 * when R2 is unreachable; `failCheck()` fails only checks.
 */
function recordingBackups(onBackup?: (tag: BackupTag, signal: AbortSignal) => Promise<void>) {
  const backups: BackupTag[] = [];
  const checks: { readDataSubset: boolean }[] = [];
  let failing = false;
  let checkFailing = false;
  const target: BackupTarget = {
    async backup(tag, signal) {
      await onBackup?.(tag, signal);
      if (failing) throw new Error("R2 unreachable");
      backups.push(tag);
    },
    async check(options) {
      if (failing) throw new Error("R2 unreachable");
      if (checkFailing) throw new Error("Pack 4f2a is damaged");
      checks.push(options);
    },
  };
  return {
    target,
    backups,
    checks,
    fail: (on = true) => {
      failing = on;
    },
    failCheck: (on = true) => {
      checkFailing = on;
    },
  };
}

function startAdmin({
  random = [QUIET, OTTER, 42],
  addressList = recordingKv().target,
  accessVerifier = fakeAccessVerifier,
  registry = openProfileRegistry(":memory:"),
  everyNight = () => {},
  backup = recordingBackups().target,
}: {
  random?: number[];
  addressList?: AddressListTarget;
  accessVerifier?: AccessVerifier;
  registry?: ProfileRegistry;
  everyNight?: (task: () => Promise<unknown>) => void;
  backup?: BackupTarget;
} = {}) {
  let now = new Date(CREATED_AT);
  const app = createApp({
    registry,
    profileDomain: "profile.example",
    addressList,
    accessVerifier,
    random: scriptedRandom(random),
    now: () => now,
    everyNight,
    backup,
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
    reconcile: () =>
      request("/api/address-list/reconcile", { method: "POST", body: JSON.stringify({}) }),
    addressListStatus: async () => (await request("/api/address-list")).json(),
    backupStatus: async () => (await request("/api/backup")).json(),
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
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");
    kv.fail();

    const response = await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(response.status).toBe(200);
    expect(await admin.list()).toEqual({ profiles: [] });
  });

  it("keeps the new Profile when the push fails", async () => {
    const kv = recordingKv();
    kv.fail();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });

    const response = await admin.create("Shopping");

    expect(response.status).toBe(201);
    expect(await admin.list()).toMatchObject({
      profiles: [{ profileAddress: "quiet.otter.42@profile.example" }],
    });
  });
});

describe("surfacing a failed push", () => {
  it("reports no failed push before anything has gone wrong", async () => {
    const admin = startAdmin();
    await admin.createProfile("Shopping");

    expect(await admin.addressListStatus()).toEqual({ pushFailed: false });
  });

  it("reports a failed push after a create, keeping the new Profile", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    await admin.reconcile();
    kv.fail();

    await admin.create("Shopping");

    expect(await admin.addressListStatus()).toEqual({ pushFailed: true });
    expect(await admin.list()).toMatchObject({
      profiles: [{ profileAddress: "quiet.otter.42@profile.example" }],
    });
  });

  it("reports a failed push after a Retire, keeping the Retire", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    const created = await admin.createProfile("Shopping");
    kv.fail();

    await admin.retire(created.id, "quiet.otter.42@profile.example");

    expect(await admin.addressListStatus()).toEqual({ pushFailed: true });
    expect(await admin.listRetired()).toMatchObject({
      profiles: [{ profileAddress: "quiet.otter.42@profile.example" }],
    });
  });

  it("keeps reporting the failure after a later push succeeds, since the failed address is still wrong in KV", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42, FADED, FOX, 7], addressList: kv.target });
    const shopping = await admin.createProfile("Shopping");
    kv.fail();
    await admin.retire(shopping.id, "quiet.otter.42@profile.example");
    kv.fail(false);

    await admin.create("Travel");

    expect(await admin.addressListStatus()).toEqual({ pushFailed: true });
  });

  it("clears the failure after a successful reconcile", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    await admin.reconcile();
    kv.fail();
    await admin.create("Shopping");
    kv.fail(false);

    const response = await admin.reconcile();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pushFailed: false });
    expect(await admin.addressListStatus()).toEqual({ pushFailed: false });
  });

  it("keeps reporting the failure when the reconcile fails too", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ random: [QUIET, OTTER, 42], addressList: kv.target });
    await admin.reconcile();
    kv.fail();
    await admin.create("Shopping");

    const response = await admin.reconcile();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Couldn't update Cloudflare's address list. Try again in a moment.",
    });
    expect(await admin.addressListStatus()).toEqual({ pushFailed: true });
  });

  it("reports a failure when a reconcile fails on its own", async () => {
    const kv = recordingKv();
    const admin = startAdmin({ addressList: kv.target });
    await admin.reconcile();
    kv.fail();

    await admin.reconcile();

    expect(await admin.addressListStatus()).toEqual({ pushFailed: true });
  });
});

describe("reconciling the address list", () => {
  /** A registry holding a live Travel and a Retired Shopping, none of it pushed. */
  async function unpushedRegistry() {
    const registry = openProfileRegistry(":memory:");
    const kv = recordingKv();
    kv.fail();
    const admin = startAdmin({ random: [QUIET, OTTER, 42, FADED, FOX, 7], registry, addressList: kv.target });
    const shopping = await admin.createProfile("Shopping");
    await admin.createProfile("Travel");
    await admin.retire(shopping.id, "quiet.otter.42@profile.example");
    return registry;
  }

  const MATCHING_KV: Record<string, AddressStatus> = {
    "quiet.otter.42@profile.example": "retired",
    "faded.fox.07@profile.example": "live",
  };

  it("makes KV exactly match the registry: live and retired statuses, and no extra keys", async () => {
    const registry = await unpushedRegistry();
    const kv = recordingKv(undefined, {
      "quiet.otter.42@profile.example": "live",
      "unknown.owl.11@profile.example": "live",
    });
    const admin = startAdmin({ registry, addressList: kv.target });

    const response = await admin.reconcile();

    expect(response.status).toBe(200);
    expect(kv.contents()).toEqual(MATCHING_KV);
    expect(kv.deletes).toEqual(["unknown.owl.11@profile.example"]);
  });

  it("pushes every issued address, even one KV already holds correctly", async () => {
    const registry = await unpushedRegistry();
    const kv = recordingKv(undefined, MATCHING_KV);
    const admin = startAdmin({ registry, addressList: kv.target });
    await vi.waitFor(() => expect(kv.puts).toHaveLength(2));
    kv.puts.length = 0;

    await admin.reconcile();

    expect(kv.puts).toEqual(
      expect.arrayContaining([
        { key: "quiet.otter.42@profile.example", value: "retired" },
        { key: "faded.fox.07@profile.example", value: "live" },
      ]),
    );
    expect(kv.puts).toHaveLength(2);
    expect(kv.deletes).toEqual([]);
  });

  it("reconciles on start-up", async () => {
    const registry = await unpushedRegistry();
    const kv = recordingKv(undefined, { "unknown.owl.11@profile.example": "live" });

    startAdmin({ registry, addressList: kv.target });

    await vi.waitFor(() => expect(kv.contents()).toEqual(MATCHING_KV));
  });

  it("reconciles on a nightly schedule", async () => {
    const nightly: (() => Promise<unknown>)[] = [];
    const registry = await unpushedRegistry();
    const kv = recordingKv();
    const admin = startAdmin({
      registry,
      addressList: kv.target,
      everyNight: (task) => nightly.push(task),
    });
    await admin.reconcile();
    await kv.target.put("unknown.owl.11@profile.example", "live");
    await kv.target.delete("faded.fox.07@profile.example");

    expect(nightly).toHaveLength(1);
    await nightly[0]?.();

    expect(kv.contents()).toEqual(MATCHING_KV);
  });

  it("clears a failure on a successful nightly reconcile", async () => {
    const nightly: (() => Promise<unknown>)[] = [];
    const kv = recordingKv();
    const admin = startAdmin({ addressList: kv.target, everyNight: (task) => nightly.push(task) });
    await admin.reconcile();
    kv.fail();
    await admin.create("Shopping");
    kv.fail(false);

    await nightly[0]?.();

    expect(await admin.addressListStatus()).toEqual({ pushFailed: false });
  });

  it("does not delete an address created after a reconcile read the registry", async () => {
    let releaseKeys: (() => void) | undefined;
    const kv = recordingKv();
    const keys = kv.target.keys;
    const admin = startAdmin({
      random: [QUIET, OTTER, 42],
      addressList: {
        ...kv.target,
        keys: async () => {
          await new Promise<void>((resolve) => {
            releaseKeys = resolve;
          });
          return keys();
        },
      },
    });
    // The start-up reconcile has read the empty registry and waits to list KV.
    await vi.waitFor(() => expect(releaseKeys).toBeDefined());

    const created = admin.create("Shopping");
    await vi.waitFor(async () => expect(await admin.list()).toMatchObject({ profiles: [{}] }));
    releaseKeys?.();
    await created;
    // The fake KV settles in microtasks, so one macrotask lets the reconcile finish.
    await new Promise((resolve) => setTimeout(resolve));

    expect(kv.contents()).toEqual({ "quiet.otter.42@profile.example": "live" });
  });

  it("refuses a reconcile request that is not sent as application/json", async () => {
    const registry = await unpushedRegistry();
    const kv = recordingKv();
    const admin = startAdmin({ registry, addressList: kv.target });
    await vi.waitFor(() => expect(kv.contents()).toEqual(MATCHING_KV));
    await kv.target.put("unknown.owl.11@profile.example", "live");

    const response = await admin.request("/api/address-list/reconcile", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });

    expect(response.status).toBe(400);
    expect(kv.contents()).toMatchObject({ "unknown.owl.11@profile.example": "live" });
  });
});

describe("taking Backups", () => {
  it("takes a Backup on start-up, even when nothing changed", async () => {
    const backups = recordingBackups();

    startAdmin({ backup: backups.target });

    await vi.waitFor(() => expect(backups.backups).toEqual(["startup"]));
  });

  it("takes a Backup after a create, once the new Profile has committed", async () => {
    const listedAtBackup: unknown[] = [];
    const backups = recordingBackups(async (tag) => {
      if (tag === "change") listedAtBackup.push(await admin.list());
    });
    const admin = startAdmin({ random: [QUIET, OTTER, 42], backup: backups.target });

    await admin.create("Shopping");

    await vi.waitFor(() =>
      expect(listedAtBackup).toEqual([
        { profiles: [expect.objectContaining({ label: "Shopping" })] },
      ]),
    );
  });
  it("takes a Backup after a rename, once the new Label has committed", async () => {
    const listedAtBackup: unknown[] = [];
    let changes = 0;
    const backups = recordingBackups(async (tag) => {
      if (tag === "change" && ++changes === 2) listedAtBackup.push(await admin.list());
    });
    const admin = startAdmin({ backup: backups.target });
    const { id } = await admin.createProfile("Shopping");

    await admin.rename(id, "Groceries");

    await vi.waitFor(() =>
      expect(listedAtBackup).toEqual([
        { profiles: [expect.objectContaining({ label: "Groceries" })] },
      ]),
    );
  });

  it("takes a Backup after a Retire, once the Retire has committed", async () => {
    const retiredAtBackup: unknown[] = [];
    let changes = 0;
    const backups = recordingBackups(async (tag) => {
      if (tag === "change" && ++changes === 2) retiredAtBackup.push(await admin.listRetired());
    });
    const admin = startAdmin({ random: [QUIET, OTTER, 42], backup: backups.target });
    const { id } = await admin.createProfile("Shopping");

    await admin.retire(id, "quiet.otter.42@profile.example");

    await vi.waitFor(() =>
      expect(retiredAtBackup).toEqual([
        { profiles: [expect.objectContaining({ retiredAt: CREATED_AT })] },
      ]),
    );
  });

  it("takes no Backup for a rejected request", async () => {
    const backups = recordingBackups();
    const admin = startAdmin({ backup: backups.target });
    await vi.waitFor(() => expect(backups.backups).toEqual(["startup"]));

    await admin.create("   ");
    await admin.rename(1, "Groceries");
    await admin.retire(1, "quiet.otter.42@profile.example");
    await new Promise((resolve) => setTimeout(resolve));

    expect(backups.backups).toEqual(["startup"]);
  });
  it("folds changes made during a running Backup into one follow-up Backup that holds them all", async () => {
    let releaseStartup: (() => void) | undefined;
    let running = 0;
    let mostAtOnce = 0;
    const listedAtBackup: unknown[] = [];
    const backups = recordingBackups(async (tag) => {
      mostAtOnce = Math.max(mostAtOnce, ++running);
      if (tag === "startup") await new Promise<void>((resolve) => (releaseStartup = resolve));
      else listedAtBackup.push(await admin.list());
      running--;
    });
    const admin = startAdmin({
      random: [QUIET, OTTER, 42, FADED, FOX, 7, QUIET, FOX, 11],
      backup: backups.target,
    });
    await vi.waitFor(() => expect(releaseStartup).toBeDefined());

    await admin.create("Shopping");
    await admin.create("Travel");
    await admin.create("Banking");
    releaseStartup?.();

    await vi.waitFor(() => expect(backups.backups).toEqual(["startup", "change"]));
    await new Promise((resolve) => setTimeout(resolve));
    expect(backups.backups).toEqual(["startup", "change"]);
    expect(listedAtBackup).toEqual([
      {
        profiles: [
          expect.objectContaining({ label: "Banking" }),
          expect.objectContaining({ label: "Travel" }),
          expect.objectContaining({ label: "Shopping" }),
        ],
      },
    ]);
    expect(mostAtOnce).toBe(1);
  });
});

describe("a Backup that runs too long", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is killed after 5 minutes and reported as failed", async () => {
    vi.useFakeTimers();
    const killed: unknown[] = [];
    const backups = recordingBackups(
      (_tag, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            killed.push(signal.reason);
            reject(new Error("restic was killed"));
          });
        }),
    );
    const admin = startAdmin({ backup: backups.target });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(killed).toEqual([]);
    expect(await admin.backupStatus()).toMatchObject({ backupFailed: false });

    await vi.advanceTimersByTimeAsync(1);
    expect(killed).toHaveLength(1);
    expect(await admin.backupStatus()).toEqual({
      backupFailed: true,
      lastSuccessfulBackupAt: null,
    });
  });
});

describe("the nightly Backup", () => {
  // Local time, as on the Pi.
  const OCTOBER_23 = new Date(2026, 9, 23, 3, 0).toISOString();
  const NOVEMBER_1 = new Date(2026, 10, 1, 3, 0).toISOString();

  async function startNightly() {
    const nightly: (() => Promise<unknown>)[] = [];
    const backups = recordingBackups();
    const admin = startAdmin({ backup: backups.target, everyNight: (task) => nightly.push(task) });
    await vi.waitFor(() => expect(backups.backups).toEqual(["startup"]));
    return { admin, backups, runNightly: () => nightly[0]?.() };
  }

  it("takes a Backup every night, even when nothing changed, then checks the repository", async () => {
    const { admin, backups, runNightly } = await startNightly();
    admin.setTime(OCTOBER_23);

    await runNightly();

    expect(backups.backups).toEqual(["startup", "nightly"]);
    expect(backups.checks).toEqual([{ readDataSubset: false }]);
  });

  it("reads a sample of the backed-up data in the check on the 1st of the month", async () => {
    const { admin, backups, runNightly } = await startNightly();
    admin.setTime(NOVEMBER_1);

    await runNightly();

    expect(backups.checks).toEqual([{ readDataSubset: true }]);
  });

  it("skips the check when the nightly Backup failed", async () => {
    const { admin, backups, runNightly } = await startNightly();
    admin.setTime(OCTOBER_23);
    backups.fail();

    await runNightly();

    expect(backups.checks).toEqual([]);
    expect(await admin.backupStatus()).toEqual({
      backupFailed: true,
      lastSuccessfulBackupAt: CREATED_AT,
    });
  });

  it("reports a failed check with the time of the last successful Backup", async () => {
    const { admin, backups, runNightly } = await startNightly();
    admin.setTime(OCTOBER_23);
    backups.failCheck();

    await runNightly();

    expect(await admin.backupStatus()).toEqual({
      backupFailed: true,
      lastSuccessfulBackupAt: OCTOBER_23,
    });
  });

  it("clears a failed check on the next successful Backup", async () => {
    const { admin, backups, runNightly } = await startNightly();
    admin.setTime(OCTOBER_23);
    backups.failCheck();
    await runNightly();

    await admin.create("Shopping");

    await vi.waitFor(async () =>
      expect(await admin.backupStatus()).toMatchObject({ backupFailed: false }),
    );
  });
});

describe("surfacing a failed Backup", () => {
  const FAILED_AT = "2026-10-22T10:00:00.000Z";
  const RECOVERED_AT = "2026-10-22T11:00:00.000Z";

  it("reports the last successful Backup when nothing has gone wrong", async () => {
    const backups = recordingBackups();
    const admin = startAdmin({ backup: backups.target });

    await vi.waitFor(async () =>
      expect(await admin.backupStatus()).toEqual({
        backupFailed: false,
        lastSuccessfulBackupAt: CREATED_AT,
      }),
    );
  });

  it("reports the last successful Backup as unknown when none has succeeded since start-up", async () => {
    const backups = recordingBackups();
    backups.fail();
    const admin = startAdmin({ backup: backups.target });

    await vi.waitFor(async () =>
      expect(await admin.backupStatus()).toEqual({
        backupFailed: true,
        lastSuccessfulBackupAt: null,
      }),
    );
  });

  it("keeps the change and reports the time of the last successful Backup when one fails", async () => {
    const backups = recordingBackups();
    const admin = startAdmin({ backup: backups.target });
    await vi.waitFor(() => expect(backups.backups).toEqual(["startup"]));
    backups.fail();
    admin.setTime(FAILED_AT);

    const response = await admin.create("Shopping");

    expect(response.status).toBe(201);
    expect(await admin.list()).toMatchObject({ profiles: [{ label: "Shopping" }] });
    await vi.waitFor(async () =>
      expect(await admin.backupStatus()).toEqual({
        backupFailed: true,
        lastSuccessfulBackupAt: CREATED_AT,
      }),
    );
  });

  it("clears the failure on the next successful Backup", async () => {
    const backups = recordingBackups();
    backups.fail();
    const admin = startAdmin({ backup: backups.target });
    await vi.waitFor(async () => expect(await admin.backupStatus()).toMatchObject({ backupFailed: true }));
    backups.fail(false);
    admin.setTime(RECOVERED_AT);

    await admin.create("Shopping");

    await vi.waitFor(async () =>
      expect(await admin.backupStatus()).toEqual({
        backupFailed: false,
        lastSuccessfulBackupAt: RECOVERED_AT,
      }),
    );
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

  it("has a banner for a failed push, with a way to reconcile from the page", async () => {
    const admin = startAdmin();

    const html = await (await admin.request("/")).text();

    expect(html).toContain("The latest change didn't reach Cloudflare.");
    expect(html).toContain("Push the address list again");
  });

  it("has a banner for a failed Backup with the time of the last successful one", async () => {
    const admin = startAdmin();

    const html = await (await admin.request("/")).text();

    expect(html).toContain("The latest Backup failed.");
    expect(html).toContain("Last successful Backup:");
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
    ["/api/address-list", { method: "GET" }],
    ["/api/address-list/reconcile", { method: "POST", body: JSON.stringify({}) }],
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

// The fake scheduler above can't catch a wrong delay, so the real nightly
// schedule gets its own tests against fake timers.
describe("scheduling the nightly reconcile", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the task at 03:00 local time, then every night after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 21, 15));
    const ranAt: Date[] = [];

    scheduleNightly(async () => {
      ranAt.push(new Date());
    });
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);

    expect(ranAt).toEqual([new Date(2026, 9, 23, 3, 0), new Date(2026, 9, 24, 3, 0)]);
  });

  it("runs the same night when started before 03:00", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 1, 30));
    const ranAt: Date[] = [];

    scheduleNightly(async () => {
      ranAt.push(new Date());
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(ranAt).toEqual([new Date(2026, 9, 22, 3, 0)]);
  });

  it("keeps the schedule after a task fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 21, 15));
    let runs = 0;

    scheduleNightly(async () => {
      runs++;
      throw new Error("Cloudflare API unreachable");
    });
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);

    expect(runs).toBe(2);
  });
});

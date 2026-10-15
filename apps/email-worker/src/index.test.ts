import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index.ts";

const PERSONAL_INBOX = "owner@personal.example";

type Outcome =
  | { kind: "forwarded"; to: string; headers: Record<string, string> }
  | { kind: "rejected"; reason: string };

const REJECTED = { kind: "rejected", reason: expect.any(String) };

function inMemoryKv(entries: Record<string, string>): KVNamespace {
  const kv = { get: async (key: string) => entries[key] ?? null };
  return kv as unknown as KVNamespace;
}

async function deliver(
  to: string,
  kvEntries: Record<string, string> = {},
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const message = {
    from: "sender@elsewhere.example",
    to,
    headers: new Headers({ Subject: "Hello" }),
    raw: new ReadableStream<Uint8Array>(),
    rawSize: 0,
    setReject(reason: string) {
      outcomes.push({ kind: "rejected", reason });
    },
    async forward(rcptTo: string, headers?: Headers) {
      outcomes.push({
        kind: "forwarded",
        to: rcptTo,
        headers: Object.fromEntries(headers ?? []),
      });
      return { messageId: "fake" };
    },
  } as unknown as ForwardableEmailMessage;
  const env: Env = {
    PROFILE_ADDRESSES: inMemoryKv(kvEntries),
    PERSONAL_INBOX,
    SYSTEM_ADDRESSES: "postmaster,abuse",
  };
  await worker.email(message, env);
  return outcomes;
}

describe("email handler", () => {
  it("forwards mail for a live Profile Address to the Personal Inbox, naming the Profile Address", async () => {
    const outcomes = await deliver("quiet.otter.42@profile.example", {
      "quiet.otter.42@profile.example": "live",
    });

    expect(outcomes).toEqual([
      {
        kind: "forwarded",
        to: PERSONAL_INBOX,
        headers: { "x-profile-address": "quiet.otter.42@profile.example" },
      },
    ]);
  });

  it("normalises a mixed-case recipient before looking it up", async () => {
    const outcomes = await deliver("Quiet.Otter.42@Profile.EXAMPLE", {
      "quiet.otter.42@profile.example": "live",
    });

    expect(outcomes).toEqual([
      {
        kind: "forwarded",
        to: PERSONAL_INBOX,
        headers: { "x-profile-address": "quiet.otter.42@profile.example" },
      },
    ]);
  });

  it.each(["postmaster@profile.example", "Abuse@profile.example"])(
    "forwards mail for the System Address %s to the Personal Inbox without a KV entry",
    async (to) => {
      const outcomes = await deliver(to);

      expect(outcomes).toEqual([
        { kind: "forwarded", to: PERSONAL_INBOX, headers: {} },
      ]);
    },
  );

  it("rejects mail for an address that was never issued", async () => {
    const outcomes = await deliver("guess@profile.example");

    expect(outcomes).toEqual([REJECTED]);
  });

  it("rejects mail for a Retired Address", async () => {
    const outcomes = await deliver("faded.fox.07@profile.example", {
      "faded.fox.07@profile.example": "retired",
    });

    expect(outcomes).toEqual([REJECTED]);
  });

  it("rejects a plus-addressed recipient even when its base address is live", async () => {
    const outcomes = await deliver("quiet.otter.42+shop@profile.example", {
      "quiet.otter.42@profile.example": "live",
    });

    expect(outcomes).toEqual([REJECTED]);
  });
});

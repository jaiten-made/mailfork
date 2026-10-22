/** A Profile Address's status in Workers KV. See docs/kv-address-list.md (repo root). */
export type AddressStatus = "live" | "retired";

/** Where the address list publisher writes: one key per issued Profile Address. */
export interface AddressListTarget {
  put(profileAddress: string, status: AddressStatus): Promise<void>;
  delete(profileAddress: string): Promise<void>;
  /** Every key in the namespace. */
  keys(): Promise<string[]>;
}

/** Projects the Profile registry into the address list target. */
export interface AddressListPublisher {
  /**
   * Pushes one address after its registry write has committed. Never throws:
   * a failure is logged and kept in `pushFailed` for the next reconcile to fix.
   */
  push(profileAddress: string, status: AddressStatus): Promise<void>;
  /**
   * Pushes every issued address with its status and deletes keys the registry
   * doesn't know. Returns whether it succeeded; only success clears `pushFailed`.
   */
  reconcile(): Promise<boolean>;
  /** Whether KV may differ from the registry since a push or reconcile failed. */
  readonly pushFailed: boolean;
}

export function createAddressListPublisher(
  target: AddressListTarget,
  issuedAddresses: () => Map<string, AddressStatus>,
): AddressListPublisher {
  let pushFailed = false;

  // One KV operation at a time, so a reconcile never deletes an address
  // pushed after it read the registry.
  let queue: Promise<unknown> = Promise.resolve();
  function serially(task: () => Promise<void>) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  function failed(what: string, error: unknown) {
    pushFailed = true;
    console.error(`${what} failed:`, error instanceof Error ? error.message : error);
  }

  return {
    get pushFailed() {
      return pushFailed;
    },

    async push(profileAddress, status) {
      try {
        await serially(() => target.put(profileAddress, status));
      } catch (error) {
        failed("Address list push", error);
      }
    },

    async reconcile() {
      try {
        await serially(async () => {
          const issued = issuedAddresses();
          for (const [profileAddress, status] of issued) {
            await target.put(profileAddress, status);
          }
          for (const key of await target.keys()) {
            if (!issued.has(key)) await target.delete(key);
          }
        });
        pushFailed = false;
        return true;
      } catch (error) {
        failed("Address list reconcile", error);
        return false;
      }
    },
  };
}

/**
 * Writes the address list to Workers KV through the Cloudflare API. The API
 * token should be scoped to edit only this one KV namespace.
 */
export function cloudflareKvTarget(options: {
  accountId: string;
  namespaceId: string;
  apiToken: string;
}): AddressListTarget {
  const namespace = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/storage/kv/namespaces/${encodeURIComponent(options.namespaceId)}`;
  const authorization = { Authorization: `Bearer ${options.apiToken}` };

  async function call(what: string, url: string, init: RequestInit = {}) {
    const response = await fetch(url, {
      ...init,
      headers: { ...authorization, ...init.headers },
    });
    if (!response.ok) {
      throw new Error(`Workers KV ${what} failed with HTTP ${response.status}`);
    }
    return response;
  }

  return {
    async put(profileAddress, status) {
      await call("put", `${namespace}/values/${encodeURIComponent(profileAddress)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: status,
      });
    },

    async delete(profileAddress) {
      await call("delete", `${namespace}/values/${encodeURIComponent(profileAddress)}`, {
        method: "DELETE",
      });
    },

    async keys() {
      const keys: string[] = [];
      let cursor = "";
      do {
        const query = new URLSearchParams({ limit: "1000" });
        if (cursor) query.set("cursor", cursor);
        const response = await call("list", `${namespace}/keys?${query}`);
        const page = (await response.json()) as {
          result: { name: string }[];
          result_info?: { cursor?: string };
        };
        keys.push(...page.result.map(({ name }) => name));
        cursor = page.result_info?.cursor ?? "";
      } while (cursor);
      return keys;
    },
  };
}

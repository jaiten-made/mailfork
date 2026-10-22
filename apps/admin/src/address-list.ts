/** A Profile Address's status in Workers KV. See docs/kv-address-list.md (repo root). */
export type AddressStatus = "live" | "retired";

/** Where the address list publisher writes: one key per issued Profile Address. */
export interface AddressListTarget {
  put(profileAddress: string, status: AddressStatus): Promise<void>;
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
  const values = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/storage/kv/namespaces/${encodeURIComponent(options.namespaceId)}/values/`;
  return {
    async put(profileAddress, status) {
      const response = await fetch(values + encodeURIComponent(profileAddress), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${options.apiToken}`,
          "Content-Type": "text/plain",
        },
        body: status,
      });
      if (!response.ok) {
        throw new Error(`Workers KV put failed with HTTP ${response.status}`);
      }
    },
  };
}

export interface NormalisedAddress {
  address: string;
  localPart: string;
  domain: string;
}

/**
 * Trims and lowercases an address, then splits it at the last `@`.
 * Returns null if either side of the `@` is empty or there is no `@`.
 */
export function normaliseAddress(raw: string): NormalisedAddress | null {
  const address = raw.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return {
    address,
    localPart: address.slice(0, at),
    domain: address.slice(at + 1),
  };
}

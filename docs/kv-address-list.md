# Workers KV address list

The Email Worker decides whether to forward or reject mail by looking the recipient up in the `PROFILE_ADDRESSES` KV namespace. The admin app's address list publisher writes it; the Worker only reads it.

## Format

- **Key:** one per issued Profile Address, normalised (trimmed and lowercased), as the full address: `quiet.otter.42@profile.example`.
- **Value:** the address's status only, exactly `live` or `retired`.

Nothing else goes in KV: no Labels, no Profile ids, no timestamps and never the Personal Inbox. Cloudflare's copy reveals only which addresses exist and whether they still accept mail.

## How the admin app writes it

The Profile registry is the source of truth, and KV is a projection of it.

- **After each change** (create or Retire), the registry write commits first, then the publisher pushes that one address.
- **A full reconcile** pushes every issued address with its status and deletes every key the registry doesn't know. It runs on start-up, every night at 03:00 local time, and on demand from the page.
- **Pushes and reconciles run one at a time**, so a reconcile never deletes an address pushed after it read the registry.
- **A failed push or reconcile** leaves the registry change committed and shows a banner on the page until a reconcile succeeds. A later successful single push doesn't clear it, since the failed address may still be wrong in KV.

The API token needs Workers KV edit access to this namespace only: reconcile lists keys and deletes them as well as writing values.

## How the Worker reads it

1. The recipient is normalised (trimmed and lowercased).
2. A System Address (`postmaster`, `abuse`) is forwarded to the Personal Inbox without a KV lookup.
3. `live` is forwarded to the Personal Inbox with an `X-Profile-Address` header naming the Profile Address.
4. `retired`, a missing key or any other value is rejected with `setReject()`, a permanent error. Plus-addressed recipients (`name+tag@`) have no key, so they are rejected too.

The Personal Inbox (`PERSONAL_INBOX` secret) and the System Address list (`SYSTEM_ADDRESSES` var) come from Worker configuration, not KV (ADR 0001, ADR 0002). Like the other secrets, the Personal Inbox's source of truth is the Owner's password manager.

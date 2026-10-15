# Workers KV address list

The Email Worker decides whether to forward or reject mail by looking the recipient up in the `PROFILE_ADDRESSES` KV namespace. The admin app's address list publisher writes it; the Worker only reads it.

## Format

- **Key:** one per issued Profile Address, normalised (trimmed and lowercased), as the full address: `quiet.otter.42@profile.example`.
- **Value:** the address's status only, exactly `live` or `retired`.

Nothing else goes in KV: no Labels, no Profile ids, no timestamps and never the Personal Inbox. Cloudflare's copy reveals only which addresses exist and whether they still accept mail.

## How the Worker reads it

1. The recipient is normalised (trimmed and lowercased).
2. A System Address (`postmaster`, `abuse`) is forwarded to the Personal Inbox without a KV lookup.
3. `live` is forwarded to the Personal Inbox with an `X-Profile-Address` header naming the Profile Address.
4. `retired`, a missing key or any other value is rejected with `setReject()`, a permanent error. Plus-addressed recipients (`name+tag@`) have no key, so they are rejected too.

The Personal Inbox (`PERSONAL_INBOX` secret) and the System Address list (`SYSTEM_ADDRESSES` var) come from Worker configuration, not KV (ADR 0001, ADR 0002). Like the other secrets, the Personal Inbox's source of truth is the Owner's password manager.

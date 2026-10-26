# Provisioning the mail path

How the Owner sets up the Profile Domain on Cloudflare and checks that real mail flows (issue #3). It needs a Cloudflare account, a card to buy the domain, and one outside mail account that is not the Personal Inbox. Do the steps in order: each one depends on the one before.

`scripts/setup-cloudflare.sh` walks through these steps interactively and continues into the Cloudflare part of `docs/deployment.md`.

Cloudflare moves its dashboard menus around. If a menu named here has moved, the linked Cloudflare docs have the current path.

## 1. Register the Profile Domain

Pick a new, unremarkable domain used for nothing else (see `GLOSSARY.md`). Avoid anything that hints at the Owner's name, location or other domains.

The simplest path is Cloudflare Registrar (dashboard: **Domain Registration → Register Domains**): the DNS is on Cloudflare from the start and the WHOIS record is redacted. With another registrar, turn on WHOIS privacy, add the domain to Cloudflare, and change the registrar's nameservers to the two Cloudflare gives you. Wait until Cloudflare shows the domain as **Active**.

**Check:** the domain is listed as Active in the Cloudflare dashboard.

## 2. Turn on Email Routing

Docs: <https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/>

On the Profile Domain, open **Email → Email Routing** and enable it. Let Cloudflare add the MX and SPF records it proposes. Remove any other MX records first, so Email Routing's are the only ones.

**Check:** the Email Routing page reports the DNS records as configured, and `dig +short MX <profile domain>` lists only `*.mx.cloudflare.net` hosts.

## 3. Verify the Personal Inbox

On the same page, open **Destination addresses**, add the Personal Inbox, and click the link in the verification mail Cloudflare sends to it. `forward()` only delivers to verified destinations (ADR 0002).

**Check:** the Personal Inbox shows as **Verified**.

## 4. Create the KV namespace

From the repo root:

```bash
cd apps/email-worker
pnpm exec wrangler login
pnpm exec wrangler kv namespace create PROFILE_ADDRESSES
```

Save the `id` it prints as `KV_NAMESPACE_ID` in `deploy/admin.env` (copy it from `deploy/admin.env.example` if it doesn't exist yet). Don't put it in `wrangler.jsonc`: that file keeps `REPLACE_WITH_KV_NAMESPACE_ID`, so no deployment's ids land in git (ADR 0004). `scripts/worker-config.sh` writes `wrangler.local.jsonc`, which git ignores, with the id filled in, and `pnpm run deploy` runs it first. The admin app's publisher reads the same id, and the account id, from `admin.env` later.

**Check:** `pnpm exec wrangler kv namespace list` shows `PROFILE_ADDRESSES` with that id.

## 5. Deploy the Worker and set the Personal Inbox

Still in `apps/email-worker`:

```bash
pnpm run deploy
pnpm exec wrangler secret put PERSONAL_INBOX -c wrangler.local.jsonc
```

Type the Personal Inbox address at the prompt. It goes only into the Worker secret, never into git or a shell history. `SYSTEM_ADDRESSES` (`postmaster,abuse`) is already in `wrangler.jsonc`.

**Check:** `pnpm exec wrangler secret list -c wrangler.local.jsonc` shows `PERSONAL_INBOX`, and the Worker `mailfork-email` appears under **Workers & Pages**.

## 6. Route all mail to the Worker

Docs: <https://developers.cloudflare.com/email-routing/email-workers/enable-email-workers/>

In **Email Routing → Routing rules**, edit the **Catch-all address**: set the action to **Send to a Worker**, pick `mailfork-email`, and enable the rule. Don't add per-address custom rules: every decision belongs to the Worker and KV.

**Check:** the catch-all rule is enabled and points at `mailfork-email`.

## 7. Seed a test address

Until the admin app is publishing, put one `live` key in KV by hand. Use a local part that the generator would never produce, so it can't clash with a real Profile later:

```bash
pnpm exec wrangler kv key put --binding PROFILE_ADDRESSES --remote "seed-test@<profile domain>" live -c wrangler.local.jsonc
```

Keys are full, lowercased addresses and values are exactly `live` or `retired` (`docs/kv-address-list.md`). KV can take about a minute to reach the Worker, so wait before step 8.

## 8. Send real mail

Send each mail from the outside account. Don't send from the Personal Inbox itself: Gmail hides mail you sent to yourself in Sent, which looks like a failure.

| Send to | Expected |
| --- | --- |
| `seed-test@<profile domain>` | Arrives in the Personal Inbox. **Show original** has `X-Profile-Address: seed-test@<profile domain>`. |
| `never-issued@<profile domain>` | The outside account gets a bounce with a permanent (5xx) error. Nothing reaches the Personal Inbox. |
| `postmaster@<profile domain>` | Arrives in the Personal Inbox, without `X-Profile-Address`. |

If mail doesn't arrive, look at **Email Routing → Activity log** first: it shows whether Cloudflare delivered, rejected or dropped each message.

## 9. Clean up

Delete the test key, so it never looks like an issued Profile Address:

```bash
pnpm exec wrangler kv key delete --binding PROFILE_ADDRESSES --remote "seed-test@<profile domain>" -c wrangler.local.jsonc
```

The admin app's full reconcile would also remove it, since it deletes keys not in the registry. Then set up the Gmail filter from the README.

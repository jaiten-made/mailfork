# mailfork

Separate identities (Profiles), each with its own email address on a dedicated Profile Domain, so the services you sign up with can't link them to each other or to you. Mail to a live Profile Address is forwarded to your Personal Inbox. Mail to a Retired or never-issued address bounces. You create, rename and Retire Profiles from a small admin app on your own server. Terms are defined in `GLOSSARY.md`.

The code and docs call the product Private Profile. You run your own copy, with one Owner per deployment.

## What it hides, and what it doesn't

- **Hides:** your Personal Inbox address from anyone who mails a Profile Address, and the link between your Profiles. Profile Labels and your Personal Inbox address never leave your server and its encrypted Backups.
- **Doesn't hide:** anything you send back from the Personal Inbox (see [Don't reply from the Personal Inbox](#dont-reply-from-the-personal-inbox)). Your Personal Inbox's provider also sees every Profile's mail.
- **Trusts Cloudflare:** Cloudflare receives every message and knows which Profile Addresses exist and whether they're live.

## Why Cloudflare instead of your own mail server

Running Postfix or similar at home looks simpler, but it doesn't work well for this (ADR 0002):

- **Inbound mail needs port 25 and a public IPv4 address.** Many home connections are behind CGNAT or have port 25 blocked by the ISP.
- **Mail from a home IP gets blocked.** Residential IP ranges are on spam blocklists, so many providers reject or junk mail forwarded from them.
- **Your MX record would publish your home IP**, linking every Profile to one house. That's the opposite of the point.
- **Mail waits when the server does.** A reboot or a dead disk delays password resets and verification codes, and a long outage bounces them.

So the work is split:

- **Cloudflare Email Routing** receives all mail for the Profile Domain, and a small **Email Worker** forwards or rejects each message by looking the address up in **Workers KV**. Mail keeps flowing when your server is off, and your home IP is never published.
- **Your server** holds the Profiles in SQLite, runs the admin app, and pushes the list of live and Retired addresses to KV. It has no open ports: it's reachable only through **Cloudflare Tunnel**, with sign-in through **Cloudflare Access**.
- **Cloudflare R2** stores the Backups. The Profile database is the only state that can't be rebuilt from git, and it records every address ever issued, which keeps Retired Addresses from being reused. restic encrypts it on your server before upload, so R2 only ever sees ciphertext (ADR 0003).

For personal use, all of this fits Cloudflare's free tiers. You pay for the domain.

## What you need

- A new, unremarkable domain to use as the Profile Domain, with its DNS on Cloudflare. Use it for nothing else, and don't pick a name that hints at you.
- A free Cloudflare account.
- An always-on Linux machine with Docker, arm64 or amd64, for the admin app. A small home server or single-board computer is enough.
- On your own machine: Node, pnpm, and optionally `restic`.
- A Personal Inbox. The filter instructions below are for Gmail.

## Setting it up

1. **The mail path.** Run `scripts/setup-cloudflare.sh`, or follow `docs/provisioning.md` by hand. It walks you through registering the Profile Domain, turning on Email Routing, deploying the Worker and sending the first real mail, then the API token, tunnel, Access application and Backup bucket from `docs/deployment.md`. It opens each page, runs the `wrangler` commands and saves the non-secret settings to `deploy/admin.env`. Tokens never pass through it, except the R2 key pair, which it hands straight to `restic init` without saving.
2. **The admin app.** Follow `docs/deployment.md` on your server: copy the settings and secrets over, clone the repo, and start it with Docker Compose.
3. **Updates.** Run `DEPLOY_HOST=<user>@<server> scripts/deploy.sh` from your machine once a release is on `main`. Redeploy the Worker with `pnpm --dir apps/email-worker run deploy`.

Your deployment's values (domain, account and namespace ids, secrets) stay in `deploy/admin.env` and on the server, never in git (ADR 0004).

## Layout

- `apps/email-worker`: the Cloudflare Email Worker that forwards or rejects each message.
- `apps/admin`: the admin app for creating, renaming and Retiring Profiles.
- `packages/shared`: address rules used by both.

## Development

```bash
pnpm install
pnpm check
```

`pnpm check` runs the dash check, the typecheck and build, and the tests.

## Labelling Profile mail in Gmail

Forwarded mail keeps its original `To`, so one filter labels all Profile mail:

1. In Gmail's search box, enter `to:(@<profile domain>)` and open **Show search options**.
2. Click **Create filter**, tick **Apply the label**, and choose a new label such as `Profile`.
3. Tick **Never send it to Spam**. Forwarded mail from a new Profile Domain often lands in Spam at first.
4. Also tick **Also apply filter to matching conversations** and create the filter.

Mail where the Profile Address is only in `Bcc` may not match. The Worker also adds an `X-Profile-Address` header naming the Profile Address, which **Show original** shows, but Gmail can't filter on it.

## Don't reply from the Personal Inbox

Forwarded mail keeps the original `From` and `Reply-To`, so anything sent back from the Personal Inbox reveals the real address to the sender (ADR 0001). That includes:

- replies and forwards;
- auto-responders, such as Gmail's vacation responder;
- `mailto:` unsubscribe links;
- calendar invite RSVPs.

Treat the `Profile` label as "read only". Replying as a Profile is a planned feature and the real fix. Until then, the Personal Inbox's provider also sees every Profile's mail in one place.

## Licence

MIT, see `LICENSE`. Provided as-is: self-host it at your own risk, with no support promise. Report security problems privately, as `SECURITY.md` describes.

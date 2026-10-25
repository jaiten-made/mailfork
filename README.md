# Private Profile

Separate identities (Profiles), each with its own email address on a dedicated Profile Domain. Mail to a live Profile Address is forwarded to the Owner's Personal Inbox; mail to a Retired or never-issued address bounces. Cloudflare receives the mail and a Raspberry Pi holds the Profiles (ADR 0002). Terms are defined in `GLOSSARY.md`.

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

## Setting up the mail path

Follow `docs/provisioning.md` to register the Profile Domain, turn on Email Routing, deploy the Worker and send the first real mail.

`scripts/setup-cloudflare.sh` walks through the same steps, plus the API token, tunnel, Access application and Backup bucket from `docs/pi-deployment.md`. It opens each page, runs the `wrangler` commands and saves the non-secret settings to `deploy/admin.env`. Tokens never pass through it, except the R2 key pair, which it hands straight to `restic init` without saving.

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

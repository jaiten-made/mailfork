# Keep a deployment's values out of git

The repo is public, and anyone who links a Profile Domain or a Cloudflare account to the Owner can link every Profile to them. So nothing specific to one deployment is ever committed: not the Profile Domain, account or namespace ids, hostnames, or secrets. `wrangler.jsonc` keeps `REPLACE_WITH_KV_NAMESPACE_ID`, and `scripts/worker-config.sh` writes a gitignored `wrangler.local.jsonc` from `deploy/admin.env` before every Worker deploy, the same file that already holds the admin app's settings.

## Considered Options

- **Commit the ids**: the usual Wrangler setup, and what this repo did while it was private. Once public, it would publish the Owner's deployment.
- **A private fork per deployment**: upstream plus a commit with the deployment's values. Rejected because the only value in git was one KV namespace id, and a fork would add a second repo, a rebase on every release, and the risk of pushing that commit to the public repo.

## Consequences

- Wrangler commands against the deployed Worker, such as `secret put` and `kv key put --binding`, take `-c wrangler.local.jsonc`.

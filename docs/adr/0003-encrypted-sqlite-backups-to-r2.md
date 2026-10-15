# Back up only the Profile database, encrypted on the Pi, to Cloudflare R2

The SQLite database is the only state that can't be rebuilt. It holds every Profile Address ever issued, including Retired ones, and "unique forever" depends on that list. It also links every Profile to the Owner, so a leaked backup would undo the product. Everything else is rebuilt from git, and secrets live in the Owner's password manager. restic encrypts on the Pi before uploading to R2. It runs after every create or Retire, and again nightly, so no change is ever lost. A restore refuses to push to Workers KV if the restored data knows of fewer Retired Addresses than KV does, so a stale backup can't bring a Retired Address back to life.

## Considered Options

- **GCS or Backblaze B2**: these would have kept backups outside Cloudflare. We chose R2 because the Owner already uses Cloudflare. As a result, losing the Cloudflare account leaves the Pi as the only copy. A second restic copy to local USB is the planned mitigation if that becomes a concern.
- **SD card images**: large, stale, and they capture unrelated services on the Pi.

## Consequences

- If the restic password is lost, the backups can't be recovered. It must live in the Owner's password manager, not only on the Pi.
- The restore procedure must be rehearsed before go-live, then occasionally afterwards.

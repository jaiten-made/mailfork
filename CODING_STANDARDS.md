# Coding standards

Read during review. These are judgement calls; mechanical rules live in `pnpm check` and the pre-commit hook.

## Privacy

- **One rejection reason.** Every rejected recipient gets the same `setReject()` reason, so a sender can't tell a Retired Address from one never issued, or either from a malformed one.
- **The Personal Inbox stays private.** Its address lives only in the Worker's `PERSONAL_INBOX` secret and on the Pi. It never appears in git, Workers KV, forwarded headers, logs or error messages. Tests use `example` domains.
- **KV holds status only.** Values are `live` or `retired`, nothing else (see `docs/kv-address-list.md`). Labels, Profile ids and timestamps stay on the Pi.

## Language

- **Glossary terms everywhere.** Identifiers, test names and test fixtures use the terms in `GLOSSARY.md` and none of the words it lists under _Avoid_. That includes string fixtures: a Retired Address fixture is `faded.fox.07`, not `burned.fox.07`.

## Tests

- **Test at the agreed seams.** The parent spec's Testing Decisions (issue #1) names three: the admin HTTP API in-process, the Email Worker's email handler, and the restore guard. A test elsewhere needs a reason in the PR.
- **Independent expected values.** Assertions compare against literals or worked examples from the spec, never a value recomputed the way the code computes it.

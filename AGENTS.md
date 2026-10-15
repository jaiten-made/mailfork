## Git flow

Commit on `feature/<issue>-<slug>`, cut from `develop`, and open the PR into `develop`. `main` only takes releases from `develop`. The pre-commit hook in `.githooks/` (turned on by `pnpm install`) enforces this.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

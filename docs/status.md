# Skyrict — System status

_Last updated: 2026-09-23_ · Maintained as part of
[REL-GATE-001](releases/2026-09-beta-1-gate.md). This page states the
*actual* state of each environment — if a row is stale, update it in the same
commit that changes reality.

## Stage

| Stage | Value |
| --- | --- |
| Product stage | **Beta** (`v0.1.0-beta.1` in release) |
| Branch | `beta` (cut at the gate SHA `da078d62`) |
| Gate | REL-GATE-001 — IN PROGRESS (see `docs/releases/2026-09-beta-1-gate.md`) |

## Environments

| Environment | Status | Endpoint | Notes |
| --- | --- | --- | --- |
| Local dev stack | 🟢 healthy (28 h+, all containers green) | `http://default.localhost` | Postgres 18/pgvector, Redis, mailpit, ollama, nginx tenant routing; Next dev on host :3000 |
| Azure beta | 🟢 deployed | `https://app-identity-skyrict-beta.<env>.eastus.azurecontainerapps.io` / `app-core-…` | APIs only — **no web frontend** (`apps.bicep` deploys identity/core/ai-agent); `ai-agent` is internal-only |
| Staging / production | ⚪ not provisioned | — | deferred; beta is the live environment |

## Services (v0.1.0)

| Service | Port (local) | Health | Migrations |
| --- | --- | --- | --- |
| identity | 8000 | 🟢 | alembic head `0032` |
| core | 8001 | 🟢 | alembic head `0063` |
| ai-agent | 8002 | 🟢 | alembic head `0028` |
| web (Next.js dev) | 3000 (host) | 🟢 | n/a |

## Ongoing work / known limitations

- **Azure soak** is being recorded against `da078d62` (24–48 h clean-logs gate).
- **Restore drill** parity toolchain proven locally
  (SHA-256 `E0E91A22…FE7A` for the 146-table set); Azure leg pending an
  authenticated operator.
- Azure beta limitations: no web frontend, no custom domains/TLS certs,
  `ai-agent` internal-only, conservative scale knobs (max 2 replicas, pooled
  DB connections of 3) — see `docs/runbooks/azure-iac.md` §11.
- Log Analytics retention capped at 30 days; budgets alert at 50/80/90% of
  $10 (steady-state cost target $0/month on the free account).

## References

- Release gate evidence: `docs/releases/2026-09-beta-1-gate.md`
- Release runbook (promote/verify/soak/rollback/tag): `docs/runbooks/azure-release.md`
- Azure IaC runbook: `docs/runbooks/azure-iac.md`
- Changelog: `CHANGELOG.md`
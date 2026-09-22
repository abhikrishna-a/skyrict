# Release gate: REL-GATE-001 — v0.1.0-beta.1

**Gate status:** IN PROGRESS (evidence below is live-verified; Azure-side
steps pending an authenticated operator)

**Gate owner:** release engineer · **Date opened:** 2026-09-23

Gate rule: the beta announcement is blocked until every claim below is green
and signed. Each section records its evidence and who verifies it.

---

## 1. Baseline (verified live, 2026-09-23)

| Claim | Evidence | Status |
| --- | --- | --- |
| Local stack healthy ≥ 24 h | containers up 28 h, all healthy (`docker ps`) | ✅ |
| Health endpoint | `GET http://default.localhost/api/v1/health` → 200 | ✅ |
| Migrations at head | local alembic: identity `0032`, core `0063`, ai `0028` | ✅ |
| Datasets intact | tenants 177 / users 12 / audit_logs 297 | ✅ |
| Services versioned | identity/core/ai-agent at `0.1.0` | ✅ |
| `beta` branch exists | not yet — cut at `da078d62` at promote time | ⏳ |
| git tags exist | none in repo history — `v0.1.0-beta.1` is the first | ⏳ |

## 2. Suites (CI-run, falsifiable on the `beta` branch)

Falsifiability mechanism: PR `beta → dev` triggers `e2e.yml`, `lighthouse.yml`,
`ci-web.yml`, `ci-services.yml`, `codeql`, `gitleaks` on the beta ref.

| Suite | Workflow | Run ID | Result |
| --- | --- | --- | --- |
| E2E + security | `e2e.yml` (projects: reports-smoke, crm-finance, ai, perf, security) | _pending_ | ⏳ |
| Lighthouse budgets | `lighthouse.yml` (LCP ≤ 5600 ms, CLS ≤ 0.1, TBT < 560 ms) | _pending_ | ⏳ |
| Bundle budget | `ci-web.yml` → `assert-bundle-sizes.mjs` | _pending_ | ⏳ |
| Services CI | `ci-services.yml` | _pending_ | ⏳ |
| CodeQL / gitleaks | `codeql.yml`, `gitleaks.yml` | _pending_ | ⏳ |

## 3. Backend performance gate (verified live, 2026-09-23)

`make bench-core` against the running Postgres — **8/8 PASS**:

```text
- run: 2026-09-22T20:01:57Z · samples: 3, warmup: 1 · passed: 8/8
  duplicates 6.2ms · cashflow_projection 6.1ms (ref 13.1) · cashflow_naive_loop 11.6ms
  working_capital_series 25.9ms · working_capital_serial 16.5ms
  report_cache_hit 5.8ms · report_aggregate_recompute 5.2ms · report_cache_miss 12.9ms
```

Report committed: `services/core/benchmarks/results/core.md`
Dataset untouched after run (tenants 177 / users 12 / audit_logs 297 re-verified).

## 4. Restore drill — PITR parity (Azure-side, pending operator)

Process and query set: `docs/runbooks/azure-release.md` §4 +
`scripts/azure/pg-parity.sql`. The parity toolchain was proven live against
local Postgres on 2026-09-23:

```text
146 count(*) statements generated · 146 rows · 146 tables
SHA-256(parity_out.txt) = E0E91A2292DF86FE5AAB2626572744CBEB95F937096795122088F0FB6D13FE7A
```

Azure leg (requires `az` authenticated with the scratch-scoped principal):

- [ ] Fingerprint `pg-skyrict-beta` at T0 (146-table hash + alembic heads)
- [ ] `az postgres flexible-server restore --source-server pg-skyrict-beta
      --name pg-skyrict-beta-scratch --restore-point-in-time <T0 − 5 min>`
- [ ] Poll state `Ready`; fingerprint scratch; both SHA-256s match
- [ ] `pg_dump --schema-only` checksum parity (both servers)
- [ ] Delete scratch server (always, even on failure)
- [ ] Record source-drift check (T0 fingerprint vs comparison-time fingerprint)

## 5. Soak — Azure beta, 24–48 h (pending operator)

See `docs/runbooks/azure-release.md` §5. Planned-restart definition and
log-noise allowlist must be seeded from a 15-min Log Analytics sample
**before** the soak clock starts at deploy verify.

- [ ] Deploy verify at SHA `da078d62` (FQDN health, revision image pin,
      migration job states)
- [ ] T0 recorded; baseline sample + review queries dry-run
- [ ] +24 h review (monotonic within pattern)
- [ ] +48 h review — CLEAN LOGS IS THE GATE
- [ ] Revision drift guard: active image stays `da078d62`

## 6. Rollback rehearsal (evidence, pending operator)

Rehearsal is non-destructive what-if; if what-if diffs are noisy/redacted,
the stronger AZR-CD-001 idempotency gate (second phase-2 apply asserts zero
real changes) is the fallback evidence.

- [ ] `az deployment group what-if` at previous SHA — only image diff
- [ ] or: clean idempotency re-apply at current SHA
- [ ] Rollback procedure recorded in `docs/runbooks/azure-release.md` §6

## 7. Demo (recorded live, pending upload)

Recorded against the local seeded stack (the Azure beta deploys APIs only —
`apps.bicep` has no web app; local stack runs the same codebase, migrations
and nginx tenant routing the E2E suite drives).

- [x] Auth: real sign-in + MFA (TOTP) through the BFF
- [x] Analytics: `/dashboard`
- [x] ERP: `/dashboard/erp/payroll`, `/dashboard/erp/reports`
- [x] AI: `/dashboard/agents`
- [ ] `beta-demo.webm` attached to the release as an asset (not committed)

## 8. Release artifacts

| Artifact | Path | Status |
| --- | --- | --- |
| Changelog entry | `CHANGELOG.md` `[0.1.0-beta.1]` (2026-09-22) | ✅ |
| Release runbook | `docs/runbooks/azure-release.md` | ✅ |
| Status page | `docs/status.md` | ✅ |
| README stage badge | Alpha → Beta | ⏳ (flip on release commit) |
| Tag + GitHub release | `v0.1.0-beta.1` @ `da078d62`, repo `nkswalih/skyrict` | ⏳ |

## 9. Sign-off log

| Date | Step | Evidence | Signed |
| --- | --- | --- | --- |
| 2026-09-23 | §1 baseline | live checks above | — |
| 2026-09-23 | §3 bench-core | 8/8 PASS, results committed | — |
| 2026-09-23 | §7 demo (recording) | webm + screenshots | — |

> Gate signs when §2 suites, §4 drill, §5 soak, and §6 rehearsal are all
> green and recorded. Announcement is blocked otherwise.
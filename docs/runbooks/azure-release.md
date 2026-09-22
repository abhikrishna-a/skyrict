# Runbook: Beta release (REL-GATE-001)

This runbook is the operational half of the release gate. It defines the
**promote → verify → soak → rollback → tag/release** sequence for shipping
`v0.1.0-beta.1` and every subsequent beta, and it is evidence-referenced by
`docs/releases/2026-09-beta-1-gate.md`.

Workflow that deploys the environment: `.github/workflows/cd-azure-beta.yml`
(`CD - Azure Beta`, alias AZR-CD-001). Infrastructure reference:
`docs/runbooks/azure-iac.md`.

## 0. Release definition

| Item | Value |
| --- | --- |
| Version | `v0.1.0-beta.1` |
| Target SHA | the SHA that produced the green pre-release run (`da078d62`) |
| Branch | `beta`, cut at the target SHA (never move after release) |
| Environment | GitHub environment `azure-beta`, Azure RG `skyrict-beta` |
| Release repo | `nkswalih/skyrict` (the canonical remote; `origin` is the fork) |

The `beta` branch is how the suite claims stay **falsifiable**: pushes to
`beta` go through PR `beta → dev`, which triggers `e2e`, `lighthouse`,
`ci-web`/`ci-services`, `codeql`, and `gitleaks` on the beta ref. The gate is
only signed when those suites say so — not when a human says the branch looks
fine.

## 1. Pre-flight (all must pass before promote)

| # | Check | Command / evidence | Must be |
| --- | --- | --- | --- |
| 1 | E2E + security | `e2e.yml` run on the `beta` SHA | green |
| 2 | Lighthouse perf | `lighthouse.yml` (LCP ≤ 5600 ms, CLS ≤ 0.1, TBT < 560 ms) | green |
| 3 | CI bundles | `ci-web.yml` → `assert-bundle-sizes.mjs` | green |
| 4 | CI services | `ci-services.yml` | green |
| 5 | Static analysis | `codeql`, `gitleaks` runs on the SHA | clean |
| 6 | Backend perf | `make bench-core` (8/8 gates) + committed `results/core.md` | PASS |
| 7 | Restore drill | §4 of this runbook + `docs/releases/2026-09-beta-1-gate.md` | parity |
| 8 | Soak | §5 of this runbook | clean logs 24–48 h |

Any red suite, drill parity mismatch, or unhandled soak error blocks the
announcement. Fix, re-run, then promote.

## 2. Promote

```bash
git switch dev && git pull --ff-only origin dev
git switch -c beta da078d62            # the green pre-release SHA
git push origin beta
gh pr create --base dev --head beta \
  --title "beta: v0.1.0-beta.1 (release gate)" \
  --body "Cut at $SHA. Runs e2e, lighthouse, ci-*, codeql, gitleaks on the beta ref."
```

Wait for the PR suites to finish (gate the merge on them). Merge `beta → dev`
only after every suite is green.

Then roll the environment to that exact image tag:

```bash
gh workflow run cd-azure-beta.yml --ref da078d62
gh run watch --exit-status
```

`cd-azure-beta.yml` sets `IMAGE_TAG: ${{ github.sha }}` — dispatch at the SHA
pins the deploy to the immutable, gate-verified image. `workflow_dispatch`
runs regardless of `CD_AZURE_BETA_ENABLED`.

## 3. Verify deployment

```bash
az containerapp show -g skyrict-beta -n app-identity-skyrict-beta --query properties.configuration.ingress.fqdn -o tsv
az containerapp show -g skyrict-beta -n app-core-skyrict-beta    --query properties.configuration.ingress.fqdn -o tsv
```

Curl both FQDNs:

```bash
curl -fsS https://app-identity-skyrict-beta.<unique>.eastus.azurecontainerapps.io/api/v1/health
curl -fsS https://app-core-skyrict-beta.<unique>.eastus.azurecontainerapps.io/api/v1/health
```

`ai-agent` is internal-only (no public FQDN — see `azure-iac.md` §11), so
verify it by revision state inside the environment:

```bash
az containerapp revision list -g skyrict-beta -n app-ai-agent-skyrict-beta \
  --query "[?properties.active].{name:name, replicas:properties.replicas, running:properties.runningState}" -o table
az containerapp replica list -g skyrict-beta -n app-ai-agent-skyrict-beta --query "[].{name:name, state:properties.runningState}" -o table
```

Confirm the active revision's image tag is `da078d62`:

```bash
az containerapp show -g skyrict-beta -n app-core-skyrict-beta \
  --query "properties.template.containers[0].image" -o tsv   # expect ...:da078d62
```

Also confirm migrations are at head:

```bash
az containerapp job execution list -g skyrict-beta --job-name job-identity-skyrict-beta --query "[].properties.status" -o tsv
az containerapp job execution list -g skyrict-beta --job-name job-core-skyrict-beta --query "[].properties.status" -o tsv
az containerapp job execution list -g skyrict-beta --job-name job-ai-agent-skyrict-beta --query "[].properties.status" -o tsv
```

## 4. Restore drill (PITR parity)

Proves backups work **before** go-live, per ticket requirement. The editable
query set lives in `scripts/azure/pg-parity.sql`; the executable statements
are generated from it. The drill is executed against the scratch server only
— the source `pg-skyrict-beta` is never written to.

Setup (`infra/azure/modules/data.bicep`): `backupRetentionDays: 7`,
geo-redundant backup disabled → automatic backup → PITR within a 7-day
window, ≥ 5-minute lag. The restore target must be **≥ 5 min before the
latest backup point**:

```bash
az postgres flexible-server restore \
  --source-server pg-skyrict-beta -g skyrict-beta \
  --name pg-skyrict-beta-scratch \
  --restore-point-in-time <T0-minus-5min> \
  --no-wait
az postgres flexible-server show -g skyrict-beta -n pg-skyrict-beta-scratch \
  --query properties.state -o tsv   # poll until "Ready"
```

Soak start (see §5) must be **before** the restore point so the drilled
window includes real beta traffic.

### 4.1 Parity check (exact-hash comparison)

For every table in all three databases, emit `<table>|<count>`; also pin the
three alembic heads and the schema fingerprint. Concatenate sorted → SHA-256
on both servers; the hashes must be identical.

```bash
# 1. Fingerprint the SOURCE at T0 (before restore).
#    (connect via the in-VNet channel: ACA job / az flexible-server execute)
psql "$SOURCE_DSN" -At -f scripts/azure/pg-parity.sql > %TEMP%\parity_t0.txt
# 2. After scratch is Ready, fingerprint the SCRATCH.
psql "$SCRATCH_DSN" -At -f scripts/azure/pg-parity.sql > %TEMP%\parity_t1.txt
# 3. Compare sorted, hashed outputs.
(Get-Content %TEMP%\parity_t0.txt | Sort-Object | Get-FileHash -Algorithm SHA256).Hash
(Get-Content %TEMP%\parity_t1.txt | Sort-Object | Get-FileHash -Algorithm SHA256).Hash
```

A second SOURCE fingerprint taken at comparison time (T1) detects source
drift between T0 and T1: if SOURCE(T0) ≠ SOURCE(T1), re-run the delta query
set against both servers and account for drift before judging parity. A
SCRATCH hash that differs from SOURCE with no source drift == **drill
failure** == gate block.

Add the structural layer:

```bash
az postgres flexible-server execute -g skyrict-beta -n pg-skyrict-beta-scratch \
  -d skyrict_identity -q "SELECT version_num FROM alembic_version" -o tsv
```

… and the canonical `pg_dump --schema-only` checksum on both servers for
completeness.

### 4.2 Cleanup (must always run, even on drill failure)

```bash
az postgres flexible-server delete -g skyrict-beta -n pg-skyrict-beta-scratch --yes
```

> The drill uses the `azure-demo` service principal whose **scope is the
> scratch server only** — it cannot modify or delete `pg-skyrict-beta`.

## 5. Soak (24–48 h, clean-logs gate)

### 5.1 Definitions (seeded before the clock starts)

- **Planned restart**: any scale-to-zero cycle (minReplicas 0), a revision
  activation/retirement, a manual `az containerapp update`, or an ACA
  platform maintenance event. Expected; excluded from the error gate.
- **Log-noise allowlist**: the following lines are benign and excluded:
  - ACA scale-to-zero / activation lifecycle messages from the platform
  - healthcheck probes and warmup pings across services
  - `HTTP 401 Unauthenticated` for expired client sessions (expected retried
    flow)
  - graceful shutdown lines during revision replacement
  - Ollama/embedding warmup messages in `ai-agent`

### 5.2 Procedure

1. Record `T0` at deploy verify (§3). The soak clock starts there.
2. Pull a **15-minute KQL baseline** immediately from
   `ContainerAppConsoleLogs_CL` in `log-skyrict-beta`, dry-run the review
   queries below, and save the allowlist sample — *before* the clock starts.
3. At +24 h and +48 h, run the review queries (below). At +24 h the log
   volume must be monotonically within pattern; **+48 h clean is the gate**.
4. Every new error signature requires a root cause + fix + re-soak —
   unhandled soak errors block the announcement.

```kusto
// Errors and exceptions (excluding allowlist) in the soak window
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(T0) .. datetime(T0+48h))
| where Log_s matches regex @"(?i)(error|exception|traceback|fatal|panic)"
| where not(Log_s matches regex @"(?i)(scale.?to.?zero|healthcheck|warmup|401 Unauthenticated|graceful shutdown|embedding warmup)")
| summarize count() by ContainerAppName_s, ContainerName_s, bin(TimeGenerated, 1h)
| order by TimeGenerated asc

// Crash / restart signals (should be zero below the platform layer)
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(T0) .. datetime(T0+48h))
| where Log_s contains "exited with code"
| summarize count() by ContainerAppName_s, bin(TimeGenerated, 1h)

// Revision drift guard: active revision image must stay pinned
```

```bash
az containerapp revision list -g skyrict-beta -n app-core-skyrict-beta \
  --query "[?properties.active].properties.template.containers[0].image" -o tsv
```

## 6. Rollback (rehearsed before go-live, not after)

The rehearsal is **non-destructive** and executes the same decision the
release would use. Two evidence paths:

1. **Bicep what-if** (drift/noise permitting):
   ```bash
   az deployment group what-if -g skyrict-beta \
     -f infra/azure/main.bicep -p infra/azure/parameters/beta.parameters.json \
     -p deployWorkloads=true -p imageTag=<previous-SHA>
   ```
   Expect only the container-image diff for the target SHA; any other real
   change means the environment drifted and rollback needs investigation
   first.
2. **Idempotency gate** (stronger; already built into AZR-CD-001): the CD
   workflow applies the same parameters a second time and asserts **zero real
   changes** (`cd-azure-beta.yml`, idempotency gate). A clean phase-2 re-apply
   at the current SHA is itself evidence that re-applying the previous SHA is
   deterministic.

Live rollback if the release is breaking (deploy-side):

```bash
gh workflow run cd-azure-beta.yml --ref <previous-green-SHA>   # or
gh workflow run cd-azure-beta.yml --ref <previous-green-SHA> -f is_runtime_rollback=true
gh run watch --exit-status
```

Or set `CD_AZURE_BETA_ENABLED=false` on the `azure-beta` environment first to
stop further auto-deploys, then investigate from Log Analytics before
re-enabling. **Never** hand-edit schema. Migration rollbacks are Alembic
downgrades via the job pattern (`alembic downgrade -1`).

## 7. Tag + release

```bash
gh release create v0.1.0-beta.1 \
  --repo nkswalih/skyrict \
  --title "Skyrict v0.1.0-beta.1" \
  --notes-file <changelog-notes> \
  --target da078d62 \
  scripts/demo/out/beta-demo.webm \
  docs/releases/2026-09-beta-1-gate.md
git tag -a v0.1.0-beta.1 -m "Skyrict beta 1 release" da078d62 && git push origin v0.1.0-beta.1
```

Notes file: `CHANGELOG.md` entry for `0.1.0-beta.1` plus the compare link
`https://github.com/nkswalih/skyrict/compare/v0.1.0-beta.1...` once prior
tags exist. The demo video is shipped as a release asset, not committed to
the repo tree.

## 8. Key rotation (operational, after release)

*Launched at release; runs on a schedule while the beta lives.*

```bash
./scripts/azure/bootstrap-azure.ps1    # rotates ALL secrets (see azure-iac.md §4)
```

Rotation replaces KV values; running services keep the old values until the
next phase-2 apply — rotate inside a change window and re-run the CD
workflow. Environment secrets live in the `azure-beta` GitHub environment and
are never committed.

## 9. Sign-off

After every step: append a dated block to
`docs/releases/2026-09-beta-1-gate.md` with run IDs, hashes, and the
signature line `Gate signed: <name> <date>`. The gate stays open while any
claim is unverifiable.
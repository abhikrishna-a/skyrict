# SKY-118 Free Setup Guide ($0)

Step-by-step setup for the Silver/Gold medallion pipeline **at zero cost**:
local pipeline + Neon free Postgres + Power BI Desktop. Optional extras that
stay free: Fabric 60-day trial, GitHub Actions scheduling.

Everything below costs nothing. The only paid item in the whole SKY-118 story
is a permanent Fabric capacity (~$100/mo minimum) — not needed for this path.

---

## 0. Prerequisites (all free)

- This repo, `uv` installed, Python 3.11+ (the package now supports 3.11).
- A free **Neon** account (`neon.tech`) — the "Warehouse".
- **Power BI Desktop** (free) — `https://powerbi.microsoft.com/desktop`.
- Optional: a work/school Microsoft account for the Fabric trial.

## 1. Create the free Postgres (Neon)

1. Go to `https://neon.tech` → **Sign up** (GitHub or email) → free plan.
2. **Create a project** → name `skyrict` → region nearest you → **Create project**.
3. Copy the connection string from the dashboard (it looks like):
   ```
   postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb
   ```
   Keep it — it's your `SKYRICT_DB_URL`. (Neon's free tier: 0.5 GB storage,
   ~190 compute hours/month — far more than this pipeline needs.)

## 2. Run the pipeline locally

From the repo root:

```powershell
# 1) Generate the demo data (Silver JSON + expected totals) from the canonical seed
uv run --project libs/skyrict-fabric python -c "import json, pathlib; from skyrict_fabric.seed import build_seed; s = build_seed(); d = {'silver_crm_customers': [c.model_dump(mode='json') for c in s.customers], 'silver_products': [p.model_dump(mode='json') for p in s.products], 'silver_crm_opportunities': [o.model_dump(mode='json') for o in s.opportunities], 'silver_invoices': [i.model_dump(mode='json') for i in s.invoices], 'silver_payments': [p.model_dump(mode='json') for p in s.payments]}; pathlib.Path('silver.json').write_text(json.dumps(d, indent=2), encoding='utf-8'); pathlib.Path('expected.json').write_text(json.dumps({k: str(v) for k, v in s.expected.items()}, indent=2), encoding='utf-8'); print('wrote silver.json + expected.json')"

# 2) Build the Gold star schema
uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-build silver.json gold.json

# 3) Reconcile against the canonical totals (all must print PASS)
uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-reconcile gold.json expected.json

# 4) Load into Neon (SCD-1 upsert; creates the 7 gold_* tables)
$env:SKYRICT_DB_URL = "postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb"
uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-load gold.json
```

Expected output of step 4: `upserted N rows into gold_...` for all 7 tables.
Re-run step 4 any time — updates in place, never duplicates.

## 3. Verify with the parity queries

Run `fabric/samples/parity-queries.sql` against Neon (Neon's SQL editor in the
dashboard, or any Postgres client). All 10 queries must return their expected
values (deals 1000 USD / 2000 EUR, revenue 550 USD / 1200 EUR, pipeline
3000 USD, 3 customers).

## 4. Power BI Desktop (free)

1. Install Power BI Desktop → **Get data** → **PostgreSQL database**.
2. Server: `ep-xxx.region.aws.neon.tech`, Database: `neondb`, credentials from
   Neon.
3. Load the 7 `gold_*` tables. Join facts to dims on `customer_key`,
   `rep_key`, `date_key`.
4. Money measures: always `SUM` per `currency_code` — never across currencies.
5. Verify against the parity totals. That is BI-PBI-001's acceptance.

## 5. Optional: Fabric 60-day trial (free, $0, no credit card)

Requires a **work/school** Microsoft account (personal Microsoft accounts are
rejected in most regions). The trial grants a full **F64 capacity for 60
days** — Microsoft's docs: *"no credit card required"*. When it ends, items
go read-only (7-day grace to move them); nothing auto-charges.

### 5a. Minimal DoD path — load Gold into a Fabric Warehouse (paste SQL)

This is the fastest way to satisfy "Gold queryable in Fabric Warehouse;
sample queries match seeded totals."

1. Regenerate the load script (committed sample is
   `fabric/samples/warehouse-load.sql`):

   ```powershell
   uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-tsql gold.json fabric/samples/warehouse-load.sql
   ```

2. `https://app.fabric.microsoft.com` → sign in with work/school account →
   account manager (top-right) → **Start trial** → pick trial region →
   agree to terms → **Activate**. If you see any payment/upgrade screen,
   back out — the trial itself never asks for a card.
3. **+ New workspace** → name `skyrict-etl` → set **License: Trial** (F64).
4. **+ New item → Warehouse** → name `skyrict_warehouse` → wait until
   *Deploying* finishes (1–3 min).
5. Open the Warehouse → **SQL analytics endpoint** (or **Open in SSMS /
   New query** in the portal query editor).
6. Paste the entire contents of `fabric/samples/warehouse-load.sql` →
   **Run**. Expect 7 `CREATE TABLE` + 7 `ALTER TABLE` PK + 9 `INSERT`
   batches, no errors. Fabric Warehouse rejects `PRIMARY KEY` inside
   `CREATE TABLE` (Msg 24584) and `datetimeoffset` columns (Msg 24574) —
   `gold-tsql` already emits `PRIMARY KEY NONCLUSTERED ... NOT ENFORCED`
   via ALTER and `DATETIME2(6)`; do not hand-edit those back.
7. Paste `fabric/samples/parity-queries.sql` → **Run**. Switch the
   **Result:** dropdown to step through all 10 result grids. Expected:

   | Query | Expected |
   | --- | --- |
   | deals by currency | EUR 1 row / 2000; USD 1 row / 1000 |
   | revenue by currency | EUR 1 row / 1200; USD 1 row / 550 |
   | pipeline by currency | USD 1 row / 3000 |
   | customer / rep / date counts | 3 / 3 / 250 |
   | unassigned rep (NIL UUID) | 1 |
   | deal_rows = distinct_deals = join_count | 2 = 2 = 2 |

   Matching totals = DoD + BI-PBI-001 acceptance. Verified live 2026-09-23
   in workspace `skyrict-etl` / Warehouse `skyrict_warehouse`.

### 5b. Full path — run the notebooks inside Fabric

Only if you also want the medallion notebooks to execute on the trial
runtime (optional; the pipeline already works locally against Neon).

1. **+ New → Lakehouse** → `skyrict_lakehouse`.
2. **+ New → Environment** → `skyrict_env`:
   - Public libraries: `pydantic>=2.7,<3`, `sqlalchemy[asyncio]>=2.0,<3`,
     `asyncpg>=0.30,<1`, `psycopg2-binary>=2.9,<3`, `typer>=0.12,<1`,
     `pyarrow>=15,<21`
   - Custom libraries: upload the wheel built from `libs/skyrict-fabric`
     (`uv build` → `dist/skyrict_fabric-0.1.0-py3-none-any.whl`)
   - Spark settings → runtime 1.3 (Python 3.11) — compatible since the
     `requires-python >=3.11` fix
   - **Publish** (wait 5–15 min)
3. **+ New → Notebook** → import `fabric/notebooks/gold_star_schema.notebook`
   (and the two silver notebooks for the full Bronze chain). Attach
   `skyrict_env` + `skyrict_lakehouse` to each.
4. Upload `silver.json` → `Files/silver/crm_sales.json` and `expected.json` →
   `Files/gold/expected.json` (Lakehouse explorer → Files → Upload).
5. Run the gold notebook: build → reconcile (all PASS) → load. For the load
   cell, set `SKYRICT_DB_URL` to the Neon string (or a Key Vault secret).
6. When the trial ends, items go read-only — nothing is deleted, and the
   pipeline keeps working locally against Neon.

## 6. Optional: schedule it free (GitHub Actions)

Push the repo to GitHub, add a workflow that runs step 2 on a schedule:

```yaml
# .github/workflows/skyrict-fabric-load.yml
name: skyrict-fabric-load
on:
  schedule: [{ cron: "0 3 * * *" }]   # daily
  workflow_dispatch:
jobs:
  load:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-build silver.json gold.json
      - run: uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-reconcile gold.json expected.json
      - run: uv run --project libs/skyrict-fabric python -m skyrict_fabric gold-load gold.json
        env:
          SKYRICT_DB_URL: ${{ secrets.SKYRICT_DB_URL }}
```

Free tier: 2000 min/month for private repos — a daily run uses ~30.

## Cost summary

| Item | Cost |
| --- | --- |
| Pipeline (local / GitHub Actions) | $0 |
| Neon free Postgres | $0 |
| Power BI Desktop | $0 |
| Fabric trial (60 days, optional) | $0 |
| **Total** | **$0** |

The only thing that costs money is keeping a Fabric capacity running after the
trial — not required for this path.
# Runbook: Fabric ETL — Silver & Gold (SKY-118)

Operational guide for the Bronze → Silver → Gold medallion transforms in
`libs/skyrict-fabric`. Covers the Silver transforms, the Gold star schema,
lineage, reconciliation, incremental refresh, and currency rules.

## Overview

```
Bronze (raw ERP/CRM)  --silver transforms-->  Silver (cleaned, typed)  --gold builders-->  Gold (star schema)
```

- **Silver** (`skyrict_fabric/silver.py`): 10 row-level transforms. Each takes
  one raw Bronze dict and returns a validated Pydantic `Silver*` model.
- **Gold** (`skyrict_fabric/gold.py`): 7 builders. Each takes Silver models and
  returns Gold star-schema models.
- **CLI** (`python -m skyrict_fabric`): `silver-clean`, `silver-export`,
  `gold-build`, `gold-load`, `gold-reconcile`, `lineage-report`. File-path
  inputs only — credentials never appear on the command line (the Warehouse
  connection string comes from the `SKYRICT_DB_URL` env var).

## Silver transforms (table by table)

| Bronze table | Silver table | Transform | Notes |
| --- | --- | --- | --- |
| `erp_currencies` | `silver_currencies` | `transform_currencies` | code ≤3 chars, decimal_places 0–10 |
| `erp_crm_leads` | `silver_crm_leads` | `transform_crm_leads` | status normalized to lowercase |
| `erp_crm_opportunities` | `silver_crm_opportunities` | `transform_crm_opportunities` | stage normalized; amount validated |
| `erp_crm_customers` | `silver_crm_customers` | `transform_crm_customers` | credit_limit validated |
| `erp_sales_orders` | `silver_sales_orders` | `transform_sales_orders` | |
| `erp_sales_order_lines` | `silver_sales_order_lines` | `transform_sales_order_lines` | |
| `erp_invoices` | `silver_invoices` | `transform_invoices` | total validated |
| `erp_payments` | `silver_payments` | `transform_payments` | amount validated |
| `erp_journal_lines` | `silver_journal_lines` | `transform_journal_lines` | |
| `erp_products` | `silver_products` | `transform_products` | cost/sell price validated |

All transforms are **pure**: same input → same output, no I/O, no state.
Invalid money values are coerced via `validate_money` (never floats).

## Gold star schema

| Gold table | Builder | Source Silver |
| --- | --- | --- |
| `gold_dim_customer` | `build_dim_customer` | `silver_crm_customers` |
| `gold_dim_product` | `build_dim_product` | `silver_products` |
| `gold_dim_date` | `build_dim_date` | (generated date range) |
| `gold_dim_rep` | `build_dim_rep` | `silver_crm_opportunities`, `silver_crm_leads` |
| `gold_fact_deals` | `build_fact_deals` | `silver_crm_opportunities` (won only) |
| `gold_fact_revenue` | `build_fact_revenue` | `silver_invoices`, `silver_payments` |
| `gold_fact_pipeline` | `build_fact_pipeline` | `silver_crm_opportunities` (non-terminal) |

### Unassigned rep sentinel

`gold_dim_rep.source_owner_id` is `UUID NOT NULL` in the DDL, but source rows
may have a NULL owner. To keep facts referentially clean:

- Every tenant gets one **Unassigned** sentinel rep row with
  `source_owner_id = 00000000-0000-0000-0000-000000000000` (NIL UUID) and
  `rep_key = make_tenant_key(tenant_id, NIL)`.
- `gold_fact_deals` and `gold_fact_pipeline` map a NULL `owner_id` to that
  sentinel `rep_key` — facts never dangle.

## Lineage

The full Bronze → Silver → Gold mapping (136 entries) lives in
`skyrict_fabric/lineage.py` (`LINEAGE_REGISTRY`). Print it with:

```bash
uv run python -m skyrict_fabric lineage-report
```

Each entry records `bronze_table.column → silver_table.column → gold_table.column`
plus the transform name. Gold tables covered: `gold_dim_customer`,
`gold_dim_product`, `gold_fact_deals`, `gold_fact_pipeline`, `gold_fact_revenue`.

## Reconciliation (Gold parity)

`skyrict_fabric/reconciliation.py` verifies Gold aggregates match the canonical
seeded totals — the same totals BI-PBI-001 later compares its measures against.

```bash
uv run python -m skyrict_fabric gold-build silver.json gold.json
uv run python -m skyrict_fabric gold-reconcile gold.json expected.json
```

- `expected.json` keys: `"<table>.<metric>[.<CURRENCY>]"`, e.g.
  `"fact_deals.amount.USD"`, `"dim_customer.count"`.
- **Per-currency only**: amounts are summed per currency and compared per
  currency. Cross-currency sums are never computed.
- Exit code 1 if any check fails; each check prints `PASS`/`FAIL` with
  expected vs actual.

The canonical seed (`skyrict_fabric/seed.py`, `build_seed()`) is deterministic:
fixed UUIDs, 2 tenants, 2 currencies (USD/EUR). `build_gold_from_seed()`
assembles the Gold tables from it. Expected totals:

| Check | Expected |
| --- | --- |
| `fact_deals.count` | 2 |
| `fact_deals.amount.USD` | 1000 |
| `fact_deals.amount.EUR` | 2000 |
| `fact_revenue.count` | 2 |
| `fact_revenue.amount.USD` | 550 |
| `fact_revenue.amount.EUR` | 1200 |
| `fact_pipeline.count` | 1 |
| `fact_pipeline.amount.USD` | 3000 |
| `dim_customer.count` | 3 |

## Incremental refresh

- Pipeline specs in `fabric/pipelines/*.pipeline.json` declare per-table
  `watermark_col` (default `updated_at`), `pk_col` (default `id`) and
  `mode` (`FULL` or incremental).
- `skyrict_fabric/watermark.py` provides `advance_watermark()` and
  `build_incremental_clause()` — the incremental WHERE clause is generated from
  the spec, never hand-written.
- Gold builders are **idempotent upserts** (SCD-1): re-running a build over the
  same Silver rows produces the same keys, so no fan-out or duplicate facts.

## Currency rules

- All money is `Decimal`, quantized to `NUMERIC(18,4)` via `quantize_money`.
- Every money column carries a sibling currency column; `coalesce_currency`
  defaults missing currencies to `USD`.
- Never sum across currencies — group by currency first (see Reconciliation).

## Data skew & drift (documented)

Known skew in the canonical seed and how the transforms handle it:

| Skew | Where | Handling |
| --- | --- | --- |
| NULL `owner_id` on opportunities | `silver_crm_opportunities` | Mapped to the Unassigned sentinel rep (NIL UUID) in `dim_rep` + facts — facts never dangle |
| Inactive customers | `silver_crm_customers.is_active = false` | Kept in `dim_customer` (SCD-1 latest wins); BI must filter `is_active` if needed |
| Multi-currency amounts | USD + EUR in seed | Never cross-summed; every aggregate groups by `currency_code` first |
| Terminal stages excluded | `won`/`lost` | `fact_deals` keeps `won` only; `fact_pipeline` excludes terminal stages — a deal appears in exactly one fact |
| Duplicate source rows | same natural key re-ingested | SCD-1 upsert: latest `updated_at` wins, same key — no fan-out, no dupes |
| Money as float in Bronze | raw ERP payloads | `validate_money` coerces to `Decimal`; non-numeric values are rejected, never silently zeroed |

Drift guard: `tests/test_parity_queries.py` fails if `parity-queries.sql`
references a table/column missing from the DDL, or if the expected totals in
the SQL comments diverge from `seed.expected`.

## Silver Parquet export

Materialize Silver to Parquet (one file per table) with:

```bash
uv run python -m skyrict_fabric silver-export silver.json fabric/silver/
```

Writes `fabric/silver/<silver_table>.parquet` via pyarrow. This is the Silver
materialization the ticket scopes; the Parquet files are the input to the
Fabric Lakehouse.

## Warehouse registration & Gold load

`gold-load` upserts the Gold tables into a Warehouse with SCD-1 semantics:

```bash
SKYRICT_DB_URL=postgresql+psycopg2://user:pass@host:5432/warehouse \
  uv run python -m skyrict_fabric gold-load gold.json
```

- The loader uses a **sync** SQLAlchemy engine, so the URL must use a sync
  driver (`postgresql+psycopg2://`; `psycopg2-binary` is a dependency).
  `postgresql+asyncpg://` is **not** valid here — asyncpg is an async driver
  and `create_engine` rejects it.

- Tables are created if missing (`CREATE TABLE IF NOT EXISTS` semantics via
  `metadata.create_all`). In a Fabric Lakehouse, creating a table
  auto-registers it in the metastore — that **is** the registration step.
- Rows are inserted with `INSERT ... ON CONFLICT DO UPDATE` on the primary
  key: re-running the load updates changed rows and never duplicates (SCD-1).
- The loader (`skyrict_fabric/load.py`) derives DDL from the Pydantic models,
  so the same code runs against SQLite (tests) and Postgres / Fabric
  Warehouse (production). Money columns are `NUMERIC(18,4)`, UUIDs are native
  `UUID` on Postgres.
- The connection string comes only from `SKYRICT_DB_URL` — never from the
  command line.

## Parity queries (runnable)

`fabric/samples/parity-queries.sql` is executed against a real database in
`tests/test_parity_queries_runnable.py` (SQLite in-memory): the exact queries
BI-PBI-001 compares its measures against, asserting the results equal
`seed.expected`. This is the Gherkin "Gold reconciles" proven against actual
SQL, not just Python aggregates.

In production, run the same file against the Warehouse after `gold-load` —
the expected totals are in the SQL comments.
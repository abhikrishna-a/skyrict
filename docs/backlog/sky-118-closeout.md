# SKY-118 / ETL-MED-001 - Close-out

Silver/Gold medallion transforms + star models: dim_customer, dim_product,
dim_date, dim_rep, fact_deals, fact_revenue, fact_pipeline. This document
records what was delivered, item by item, with source/test citations and the
verification evidence for the final gate.

Verification status: **all items closed, all gates green** as of `023af9c2`
+ follow-up Fabric dialect fix (see [Verification gate](#verification-gate)).

**Live Fabric DoD:** closed 2026-09-23 — `warehouse-load.sql` + `parity-queries.sql`
executed in workspace `skyrict-etl` / Warehouse `skyrict_warehouse` (school
account trial); all 10 parity totals matched seed.

---

## The canonical items

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Silver validated: no null/non-numeric drift, skew documented | Done | 10 pure transforms in `libs/skyrict-fabric/src/skyrict_fabric/silver.py` (typed Pydantic output, `validate_money` rejects non-numeric, never silently zeroes); skew table in `docs/runbooks/fabric-etl.md` (NULL owners, inactive customers, multi-currency, terminal stages, duplicate rows, float money) |
| 2 | Gold star: 3 dims + date + 3 facts defined | Done | `gold.py` builders: `build_dim_customer`, `build_dim_product`, `build_dim_date`, `build_dim_rep`, `build_fact_deals`, `build_fact_revenue`, `build_fact_pipeline`; DDL in `fabric/tables/gold_*.sql` (7 files) |
| 3 | Gold loadable (SCD-1 upserts) | Done | `load.py` generic Pydantic-derived SQLAlchemy loader; `gold-load` CLI smoke-tested: all 7 tables upserted, re-run produced zero duplicates; `tests/test_load.py` (totals / idempotent / update-in-place) |
| 4 | Incremental refresh correct, no fan-out/dupes | Done | `watermark.py` (`advance_watermark`, `build_incremental_clause`); SCD-1 upserts; parity queries 8-10 assert row count == distinct deal count == join count (2 = 2 = 2); `tests/test_parity_queries_runnable.py` |
| 5 | Lineage doc Bronze -> Silver -> Gold | Done | `lineage.py` `LINEAGE_REGISTRY` (136 entries), `lineage-report` CLI, lineage section in runbook |
| 6 | Fabric notebooks / dataflows per module | Done | `fabric/notebooks/silver_crm_sales.notebook`, `silver_finance.notebook` (silver-clean + silver-export), `gold_star_schema.notebook` (gold-build + gold-reconcile + gold-load); pipeline specs in `fabric/pipelines/*.pipeline.json` with watermark/pk config |
| 7 | Silver Parquet + Gold table definitions | Done | `silver-export` CLI (pyarrow, one file per table); `fabric/tables/gold_*.sql`; `tests/test_silver_export.py` parquet round-trip |
| 8 | Currency-aware money | Done | `money.py`: `Decimal` only, `quantize_money` to NUMERIC(18,4), `coalesce_currency` defaults to USD; every money column has a sibling currency column; aggregates group by currency, never cross-sum |
| 9 | Tenant-safe keys | Done | `tenant.py` `make_tenant_key`; every Gold table keyed by tenant-scoped key; Unassigned rep sentinel (NIL UUID) per tenant so facts never dangle |
| 10 | Shared dim_date, date grain | Done | `build_dim_date` generates the full range from fact date keys; wired into both CLI `gold-build` and `build_gold_from_seed` |
| 11 | Register Gold in Warehouse/metastore | Done | `gold-load` `metadata.create_all` = registration in a Fabric Lakehouse; dialect-aware (SQLite tests / Postgres production); `SKYRICT_DB_URL` env var only, never on the command line |
| 12 | Sample queries matching seeded totals (BI-PBI-001) | Done | `fabric/samples/parity-queries.sql` (10 statements, expected totals in comments); executed against a real database in `tests/test_parity_queries_runnable.py`; drift guard `tests/test_parity_queries.py` fails if SQL references DDL-missing columns or totals diverge from `seed.expected` |
| 13 | Gherkin: Gold reconciles | Done | `gold-reconcile` CLI (exit 1 on any FAIL); `tests/test_parity_queries_runnable.py` asserts loaded facts equal `seed.expected` per currency |
| 14 | Gherkin: No fan-out | Done | parity queries 8-10: `deal_rows == distinct_deals == join_count`; seed links won deals to customers (C001->OPP_1, C002->OPP_2) so the join check is real |

## Verification gate

| Gate | Result | Evidence |
| --- | --- | --- |
| Tests | 86/86 pass | `uv run pytest -q` in `libs/skyrict-fabric` (incl. `test_emit_tsql.py`: Fabric PK via ALTER, no IDENTITY, datetime2 literals) |
| Lint | clean | `ruff check libs/skyrict-fabric` |
| Format | clean | `uv run ruff format --check` on changed files |
| Types | clean | `mypy` strict, 13 source files |
| CLI smoke | pass | `silver-export` wrote 2 parquet files; `gold-load` upserted all 7 tables (Neon); `gold-reconcile` 9/9 PASS |
| Fabric Warehouse | pass | Live trial: 7 tables loaded (3/2/250/3/2/2/1 rows); 10/10 parity queries match seed (EUR 2000/1200, USD 1000/550/3000, counts 3/3/250, join 2=2=2) |
| Working tree | clean | after follow-up commit on tip of `023af9c2` |

## Out-of-scope / external

- **Live Fabric trial execution**: **done** 2026-09-23 (was out-of-scope until
  tenant allowed a Warehouse). Dialect quirks fixed in `emit_tsql`: PK only via
  `ALTER TABLE ... PRIMARY KEY NONCLUSTERED ... NOT ENFORCED` (Msg 24584);
  `datetimeoffset` → `DATETIME2(6)` (Msg 24574).
- **BI-PBI-001 measure validation** against the live Warehouse: parity totals
  already verified in Fabric; Power BI Desktop path was verified against Neon.

## Commits

- `25354184` feat(fabric): SKY-118 add typer CLI entry point
- `49d7ba8c` docs(fabric): SKY-118 write Silver/Gold medallion runbook
- `0792dd58` feat(fabric): SKY-118 parity queries, notebooks, skew docs, drift guard
- `1f463cd1` feat(fabric): SKY-118 silver parquet export, gold Warehouse load, runnable parity SQL
- `6ba24bea` docs(fabric): SKY-118 wire export/load into notebooks, add closeout
- `0124a305` fix(fabric): SKY-118 Python 3.11 compat + psycopg2 for sync gold-load
- `fb74d196` docs(fabric): SKY-118 add $0 free-setup guide (Neon + local + Power BI)
- `023af9c2` feat(fabric): SKY-118 gold-tsql emit paste-able Fabric Warehouse load script
- `TBD` fix(fabric): SKY-118 Fabric Warehouse dialect — PK via ALTER, datetime2(6)
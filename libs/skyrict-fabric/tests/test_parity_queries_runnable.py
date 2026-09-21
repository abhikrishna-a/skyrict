"""Execute parity-queries.sql against a real (SQLite) database.

This is the ticket's Gherkin "Gold reconciles" proven against actual SQL:
load the seeded Gold tables, run the exact queries BI-PBI-001 uses, and
assert the results match the canonical seed totals.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import MetaData, create_engine, text

from skyrict_fabric.load import GOLD_MODELS, build_table, upsert_rows
from skyrict_fabric.seed import build_gold_from_seed, build_seed

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

REPO = Path(__file__).resolve().parents[3]
SQL_PATH = REPO / "fabric" / "samples" / "parity-queries.sql"


@pytest.fixture()
def engine() -> Engine:
    gold = build_gold_from_seed(build_seed())
    rows = {
        f"gold_{name}": [
            m.model_dump(mode="json")
            for m in (models.values() if isinstance(models, dict) else models)
        ]
        for name, models in gold.items()
    }
    engine = create_engine("sqlite:///:memory:")
    metadata = MetaData()
    tables = {name: build_table(model, metadata) for name, model in GOLD_MODELS.items()}
    metadata.create_all(engine)
    for name, table in tables.items():
        upsert_rows(engine, table, rows.get(name, []))
    return engine


def _statements() -> list[str]:
    sql = SQL_PATH.read_text(encoding="utf-8")
    # SQLite stores UUIDs as 32-char hex; the parity SQL uses the dashed
    # Postgres literal form. Normalize for the SQLite proxy run only -- the
    # artifact itself is unchanged and runs as-is against the Warehouse.
    sql = sql.replace("00000000-0000-0000-0000-000000000000", "00000000000000000000000000000000")
    cleaned = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in cleaned.split(";") if s.strip()]


def test_parity_queries_match_seed(engine: Engine) -> None:
    seed = build_seed()
    with engine.connect() as conn:
        results = [conn.execute(text(stmt)).all() for stmt in _statements()]

    # 1. fact_deals per currency (ORDER BY currency_code: EUR < USD)
    assert [(r[0], r[1], Decimal(str(r[2]))) for r in results[0]] == [
        ("EUR", 1, seed.expected["fact_deals.amount.EUR"]),
        ("USD", 1, seed.expected["fact_deals.amount.USD"]),
    ]
    # 2. fact_revenue per currency
    assert [(r[0], r[1], Decimal(str(r[2]))) for r in results[1]] == [
        ("EUR", 1, seed.expected["fact_revenue.amount.EUR"]),
        ("USD", 1, seed.expected["fact_revenue.amount.USD"]),
    ]
    # 3. fact_pipeline per currency
    assert [(r[0], r[1], Decimal(str(r[2]))) for r in results[2]] == [
        ("USD", 1, seed.expected["fact_pipeline.amount.USD"]),
    ]
    # 4-6. dimension counts
    assert results[3][0][0] == seed.expected["dim_customer.count"]
    assert results[4][0][0] == 3  # 2 owners + 1 Unassigned sentinel
    assert results[5][0][0] >= 1
    # 7. Unassigned sentinel present
    assert results[6][0][0] == 1
    # 8-9. no fan-out: row count equals distinct deal count
    assert results[7][0][0] == results[8][0][0] == 2
    # 10. dim/fact join does not multiply rows
    assert results[9][0][0] == results[7][0][0]

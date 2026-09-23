"""Warehouse load tests: SCD-1 upserts against SQLite (same loader as Postgres)."""

from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import MetaData, create_engine, func, select

from skyrict_fabric.load import GOLD_MODELS, build_table, upsert_rows
from skyrict_fabric.seed import build_gold_from_seed, build_seed

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine
    from sqlalchemy.sql.schema import Table


@pytest.fixture()
def gold_rows() -> dict[str, list[dict]]:
    gold = build_gold_from_seed(build_seed())
    return {
        f"gold_{name}": [
            m.model_dump(mode="json") for m in (rows.values() if isinstance(rows, dict) else rows)
        ]
        for name, rows in gold.items()
    }


@pytest.fixture()
def tables(gold_rows: dict[str, list[dict]]) -> dict[str, Table]:
    metadata = MetaData()
    return {name: build_table(model, metadata) for name, model in GOLD_MODELS.items()}


@pytest.fixture()
def engine(tables: dict[str, Table], gold_rows: dict[str, list[dict]]) -> Engine:
    engine = create_engine("sqlite:///:memory:")
    for table in tables.values():
        table.metadata.create_all(engine)
    for name, rows in gold_rows.items():
        upsert_rows(engine, tables[name], rows)
    return engine


def test_upsert_totals_match_seed(engine: Engine, tables: dict[str, Table]) -> None:
    """The Gherkin 'Gold reconciles': loaded facts equal the seeded totals."""
    seed = build_seed()
    with engine.connect() as conn:
        deals = conn.execute(
            select(
                tables["gold_fact_deals"].c.currency_code,
                func.count(),
                func.sum(tables["gold_fact_deals"].c.amount),
            ).group_by(tables["gold_fact_deals"].c.currency_code)
        ).all()
        revenue = conn.execute(
            select(
                tables["gold_fact_revenue"].c.currency_code,
                func.count(),
                func.sum(tables["gold_fact_revenue"].c.total),
            ).group_by(tables["gold_fact_revenue"].c.currency_code)
        ).all()
        pipeline = conn.execute(
            select(
                tables["gold_fact_pipeline"].c.currency_code,
                func.count(),
                func.sum(tables["gold_fact_pipeline"].c.amount),
            ).group_by(tables["gold_fact_pipeline"].c.currency_code)
        ).all()

    assert {r[0]: (r[1], Decimal(str(r[2]))) for r in deals} == {
        "USD": (1, seed.expected["fact_deals.amount.USD"]),
        "EUR": (1, seed.expected["fact_deals.amount.EUR"]),
    }
    assert {r[0]: (r[1], Decimal(str(r[2]))) for r in revenue} == {
        "USD": (1, seed.expected["fact_revenue.amount.USD"]),
        "EUR": (1, seed.expected["fact_revenue.amount.EUR"]),
    }
    assert {r[0]: (r[1], Decimal(str(r[2]))) for r in pipeline} == {
        "USD": (1, seed.expected["fact_pipeline.amount.USD"]),
    }


def test_upsert_is_idempotent(
    engine: Engine, tables: dict[str, Table], gold_rows: dict[str, list[dict]]
) -> None:
    """Re-running the load produces exactly one row per grain (no dupes)."""
    for name, rows in gold_rows.items():
        upsert_rows(engine, tables[name], rows)
    with engine.connect() as conn:
        for name, table in tables.items():
            count = conn.execute(select(func.count()).select_from(table)).scalar_one()
            assert count == len(gold_rows[name]), name


def test_upsert_updates_in_place(
    engine: Engine, tables: dict[str, Table], gold_rows: dict[str, list[dict]]
) -> None:
    """SCD-1: a changed row updates in place, count stays the same."""
    table = tables["gold_dim_customer"]
    row = gold_rows["gold_dim_customer"][0]
    row["name"] = "Renamed Customer"
    upsert_rows(engine, table, [row])

    with engine.connect() as conn:
        count = conn.execute(select(func.count()).select_from(table)).scalar_one()
        names = conn.execute(select(table.c.name)).scalars().all()
    assert count == len(gold_rows["gold_dim_customer"])
    assert "Renamed Customer" in names

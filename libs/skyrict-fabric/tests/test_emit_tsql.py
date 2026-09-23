"""Emit path for the Fabric Warehouse paste-in load script (T-SQL)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from skyrict_fabric.load import GOLD_MODELS, emit_tsql
from skyrict_fabric.seed import build_gold_from_seed, build_seed

if TYPE_CHECKING:
    from skyrict_fabric.schema import (  # noqa: F401 -- typing only
        GoldDimCustomer,
        GoldDimDate,
        GoldDimProduct,
        GoldDimRep,
        GoldFactDeals,
        GoldFactPipeline,
        GoldFactRevenue,
    )


def _gold_json() -> dict[str, list[dict]]:
    gold = build_gold_from_seed(build_seed())
    return {
        f"gold_{name}": [
            m.model_dump(mode="json") for m in (rows.values() if isinstance(rows, dict) else rows)
        ]
        for name, rows in gold.items()
    }


def test_emit_tsql_covers_all_models() -> None:
    sql = emit_tsql(_gold_json())
    for name in GOLD_MODELS:
        assert f"CREATE TABLE [{name}]" in sql, name
    # integer PK must not become IDENTITY (breaks explicit date_key inserts)
    assert "IDENTITY" not in sql
    # Fabric: PRIMARY KEY only via ALTER TABLE (Msg 24584 in CREATE TABLE)
    assert "PRIMARY KEY NONCLUSTERED" in sql
    assert "NOT ENFORCED" in sql
    assert "PRIMARY KEY (" not in sql.split("ALTER TABLE")[0]  # not inside first CREATE
    for name in GOLD_MODELS:
        assert f"ALTER TABLE [{name}] ADD CONSTRAINT [pk_{name}]" in sql, name
    # reserved date-dim columns stay bracketed
    for col in ("[year]", "[month]", "[day]", "[quarter]"):
        assert col in sql, col
    # seed row counts
    assert sql.count("INSERT INTO [gold_dim_customer]") == 1
    assert sql.count("INSERT INTO [gold_dim_date]") == 3  # 250 rows / 100 batch


def test_emit_tsql_literals() -> None:
    gold = _gold_json()
    sql = emit_tsql(gold)
    deal = gold["gold_fact_deals"][0]
    assert f"'{deal['deal_key']}'" in sql
    # Fabric datetime2(6): no offset suffix
    assert "'2026-09-21 12:00:00'" in sql
    assert "DATETIMEOFFSET" not in sql
    assert "DATETIME2(6)" in sql
    # money stays an unquoted numeric literal
    assert "1000" in sql
    # NULL optional FK
    assert "NULL" in sql

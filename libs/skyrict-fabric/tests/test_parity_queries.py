"""Drift guard: parity-queries.sql must stay consistent with the Gold DDL
and the canonical seed totals. Fails if the SQL references a table/column
missing from the DDL, or if the expected totals in the SQL comments diverge
from seed.expected."""

from __future__ import annotations

import re
from pathlib import Path

from skyrict_fabric.seed import build_seed

REPO = Path(__file__).resolve().parents[3]
SQL_PATH = REPO / "fabric" / "samples" / "parity-queries.sql"
DDL_DIR = REPO / "fabric" / "tables"

_SQL_KEYWORDS = {
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP",
    "BY",
    "ORDER",
    "JOIN",
    "ON",
    "AS",
    "COUNT",
    "SUM",
    "DISTINCT",
    "AND",
    "OR",
    "NOT",
    "NULL",
    "IN",
    "IS",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "FULL",
    "CROSS",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "ASC",
    "DESC",
    "TRUE",
    "FALSE",
    "BETWEEN",
    "LIKE",
    "INTO",
    "VALUES",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "TABLE",
    "IF",
    "EXISTS",
    "PRIMARY",
    "KEY",
    "INDEX",
    "UNIQUE",
    "DEFAULT",
    "REFERENCES",
    "CONSTRAINT",
    "CHECK",
    "CURRENT_TIMESTAMP",
    "UUID",
    "VARCHAR",
    "NUMERIC",
    "INTEGER",
    "BOOLEAN",
    "DATE",
    "TIMESTAMPTZ",
    "CHAR",
    "TEXT",
    "BIGINT",
    "SMALLINT",
    "DECIMAL",
    "REAL",
    "DOUBLE",
    "PRECISION",
    "SERIAL",
    "IDENTITY",
    "GENERATED",
    "ALWAYS",
    "CONFLICT",
    "DO",
    "NOTHING",
    "SET",
    "RETURNING",
    "WITH",
    "RECURSIVE",
    "UNION",
    "ALL",
    "INTERSECT",
    "EXCEPT",
    "CAST",
    "COALESCE",
    "NULLIF",
    "ROUND",
    "ABS",
    "MIN",
    "MAX",
    "AVG",
    "LOWER",
    "UPPER",
    "TRIM",
    "LENGTH",
    "SUBSTRING",
    "EXTRACT",
    "DATE_PART",
    "TO_CHAR",
    "TO_DATE",
    "TO_TIMESTAMP",
    "NOW",
    "CURRENT_DATE",
}


def _ddl_columns(table: str) -> set[str]:
    ddl = (DDL_DIR / f"{table}.sql").read_text(encoding="utf-8")
    cols: set[str] = set()
    for line in ddl.splitlines():
        m = re.match(
            r"\s+([a-z_][a-z0-9_]*)\s+(UUID|VARCHAR|NUMERIC|INTEGER|BOOLEAN|DATE|TIMESTAMPTZ|CHAR|TEXT)",
            line,
        )
        if m:
            cols.add(m.group(1))
    return cols


class TestParityQueries:
    def test_tables_and_columns_exist_in_ddl(self) -> None:
        sql = SQL_PATH.read_text(encoding="utf-8")
        tables = set(re.findall(r"\b(gold_[a-z_]+)\b", sql))
        assert tables, "no gold_* tables referenced"
        all_cols: set[str] = set()
        for table in tables:
            assert (DDL_DIR / f"{table}.sql").exists(), f"missing DDL for {table}"
            cols = _ddl_columns(table)
            assert cols, f"no columns parsed from {table}.sql"
            all_cols |= cols
        # every plausible column identifier in the SQL must exist in some Gold DDL
        for ident in re.findall(r"\b[a-z_][a-z0-9_]*\b", sql):
            if ident.upper() in _SQL_KEYWORDS or ident.startswith("gold_"):
                continue
            if ident in {
                "currency_code",
                "amount",
                "total",
                "source_owner_id",
                "customer_key",
                "rep_key",
                "source_opportunity_id",
            }:
                assert ident in all_cols, f"{ident} missing from Gold DDL"

    def test_expected_totals_match_seed(self) -> None:
        sql = SQL_PATH.read_text(encoding="utf-8")
        seed = build_seed()
        # expected values are documented as "Expected: ..." comments
        expected_block = sql.split("Expected:")[1:]
        assert expected_block, "no Expected: comments found"
        joined = " ".join(expected_block)
        # every seed expectation must appear in the SQL comments
        for key, value in seed.expected.items():
            table, metric = key.split(".")[:2]
            assert table in sql, f"{table} missing from parity-queries.sql"
            if metric == "count":
                assert str(value) in joined, f"count {value} not documented"
            else:
                assert str(value) in joined, f"amount {value} not documented"

"""Load Gold models into a Warehouse with SCD-1 upserts.

Table DDL is derived from the Pydantic models, so the same loader works
against SQLite (tests) and Postgres / Fabric Warehouse (production).
Creating a table in a Fabric Lakehouse auto-registers it in the metastore,
so ``create_all`` is the registration step.
"""

from __future__ import annotations

import re
import types
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Union, get_args, get_origin

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Uuid,
)
from sqlalchemy.dialects import postgresql, sqlite

from skyrict_fabric.schema import (
    GoldDimCustomer,
    GoldDimDate,
    GoldDimProduct,
    GoldDimRep,
    GoldFactDeals,
    GoldFactPipeline,
    GoldFactRevenue,
)

if TYPE_CHECKING:
    from pydantic import BaseModel
    from sqlalchemy.engine import Engine

GOLD_MODELS: dict[str, type[BaseModel]] = {
    "gold_dim_customer": GoldDimCustomer,
    "gold_dim_product": GoldDimProduct,
    "gold_dim_date": GoldDimDate,
    "gold_dim_rep": GoldDimRep,
    "gold_fact_deals": GoldFactDeals,
    "gold_fact_revenue": GoldFactRevenue,
    "gold_fact_pipeline": GoldFactPipeline,
}


def _unwrap(annotation: Any) -> Any:
    """Strip ``Optional[...]`` / ``X | None`` down to the underlying type."""
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return annotation


def _column_type(annotation: Any) -> Any:
    annotation = _unwrap(annotation)
    if annotation is uuid.UUID:
        return Uuid()
    if annotation is int:
        return Integer()
    if annotation is Decimal:
        return Numeric(18, 4)
    if annotation is datetime:
        return DateTime(timezone=True)
    if annotation is date:
        return Date()
    if annotation is bool:
        return Boolean()
    if annotation is str:
        return String(255)
    raise TypeError(f"unsupported field type: {annotation}")


def _snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def build_table(model: type[BaseModel], metadata: MetaData) -> Table:
    """Build a SQLAlchemy Table from a Pydantic model (first field = primary key)."""
    fields = list(model.model_fields.items())
    pk_name, pk_field = fields[0]
    columns = [Column(pk_name, _column_type(pk_field.annotation), primary_key=True)]
    for name, field in fields[1:]:
        columns.append(
            Column(name, _column_type(field.annotation), nullable=not field.is_required())
        )
    return Table(_snake(model.__name__), metadata, *columns)


def upsert_rows(engine: Engine, table: Table, rows: list[dict[str, Any]]) -> int:
    """SCD-1 upsert: insert rows, update on key conflict (no fan-out, no dupes)."""
    if not rows:
        return 0
    # JSON round-trips UUIDs/datetimes/dates as strings; SQLite's bind
    # processors expect native objects, so coerce before binding.
    for column in table.columns:
        if isinstance(column.type, Uuid):
            for row in rows:
                value = row.get(column.name)
                if isinstance(value, str):
                    row[column.name] = uuid.UUID(value)
        elif isinstance(column.type, DateTime):
            for row in rows:
                value = row.get(column.name)
                if isinstance(value, str):
                    row[column.name] = datetime.fromisoformat(value)
        elif isinstance(column.type, Date):
            for row in rows:
                value = row.get(column.name)
                if isinstance(value, str):
                    row[column.name] = date.fromisoformat(value)
    _insert = sqlite.insert if engine.dialect.name == "sqlite" else postgresql.insert
    stmt = _insert(table).values(rows)
    pk = [c.name for c in table.primary_key.columns]
    update = {c.name: stmt.excluded[c.name] for c in table.columns if c.name not in pk}
    stmt = stmt.on_conflict_do_update(index_elements=pk, set_=update)
    with engine.begin() as conn:
        conn.execute(stmt)
    return len(rows)


def _tsql_type(annotation: Any) -> str:
    annotation = _unwrap(annotation)
    if annotation is uuid.UUID:
        return "UNIQUEIDENTIFIER"
    if annotation is int:
        return "INTEGER"
    if annotation is Decimal:
        return "NUMERIC(18, 4)"
    if annotation is datetime:
        # Fabric Warehouse: datetimeoffset unsupported → datetime2(6)
        return "DATETIME2(6)"
    if annotation is date:
        return "DATE"
    if annotation is bool:
        return "BIT"
    if annotation is str:
        return "VARCHAR(255)"
    raise TypeError(f"unsupported field type: {annotation}")


def _tsql_literal(tsql_type: str, value: Any) -> str:
    if value is None:
        return "NULL"
    if tsql_type == "BIT":
        return "1" if value else "0"
    if tsql_type == "UNIQUEIDENTIFIER":
        return f"'{value}'"
    if tsql_type in ("NUMERIC(18, 4)", "INTEGER"):
        return str(value)
    if tsql_type == "DATETIME2(6)":
        # Fabric datetime2 rejects offsets; keep ISO wall-clock only
        text = str(value).replace("T", " ")
        if "+" in text:
            text = text.split("+")[0]
        if text.endswith("Z"):
            text = text[:-1]
        return f"'{text.strip()}'"
    if tsql_type == "DATE":
        return f"'{str(value)[:10]}'"
    return "'" + str(value).replace("'", "''") + "'"


def emit_tsql(gold: dict[str, list[dict[str, Any]]]) -> str:
    """Render gold.json as paste-able T-SQL for a Fabric Warehouse SQL endpoint.

    Hand-rolled DDL (not SQLAlchemy mssql compile) so integer PKs never become
    IDENTITY, reserved column names (year/month/day) stay bracketed, and PKs
    are ALTERed in (Fabric rejects PRIMARY KEY inside CREATE TABLE, Msg 24584).
    """
    lines = [
        "-- SKY-118: load Gold star schema into Fabric Warehouse (T-SQL)",
        "-- Generate: python -m skyrict_fabric gold-tsql gold.json warehouse-load.sql",
        "-- Paste into the Warehouse SQL endpoint editor and run once.",
        "",
    ]
    for name, model in GOLD_MODELS.items():
        rows = gold.get(name, [])
        fields = list(model.model_fields.items())
        col_defs: list[str] = []
        col_names: list[str] = []
        types: list[str] = []
        for i, (fname, field) in enumerate(fields):
            tsql_type = _tsql_type(field.annotation)
            types.append(tsql_type)
            col_names.append(f"[{fname}]")
            # T-SQL columns are nullable by default — required ones need NOT NULL
            required = i == 0 or field.is_required()
            null_sql = " NOT NULL" if required else " NULL"
            col_defs.append(f"    [{fname}] {tsql_type}{null_sql}")
        pk = fields[0][0]
        lines.append(f"IF OBJECT_ID(N'{name}', N'U') IS NOT NULL DROP TABLE [{name}];")
        lines.append(f"CREATE TABLE [{name}] (")
        lines.append(",\n".join(col_defs))
        lines.append(");")
        # Fabric rejects PRIMARY KEY inside CREATE TABLE (Msg 24584)
        lines.append(
            f"ALTER TABLE [{name}] ADD CONSTRAINT [pk_{name}] "
            f"PRIMARY KEY NONCLUSTERED ([{pk}]) NOT ENFORCED;"
        )
        if rows:
            cols = ", ".join(col_names)
            # ponytail: 100 rows/statement stays under T-SQL VALUES limits
            for start in range(0, len(rows), 100):
                chunk = rows[start : start + 100]
                tuples = []
                for row in chunk:
                    vals = [
                        _tsql_literal(types[j], row.get(fields[j][0])) for j in range(len(fields))
                    ]
                    tuples.append("(" + ", ".join(vals) + ")")
                lines.append(f"INSERT INTO [{name}] ({cols}) VALUES")
                lines.append(",\n".join(tuples) + ";")
        lines.append("")
    return "\n".join(lines) + "\n"

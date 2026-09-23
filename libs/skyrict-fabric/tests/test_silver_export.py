"""Silver Parquet export tests (pyarrow round-trip)."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pyarrow as pa
import pyarrow.parquet as pq

from skyrict_fabric.seed import build_seed

if TYPE_CHECKING:
    from pathlib import Path


def test_parquet_roundtrip(tmp_path: Path) -> None:
    seed = build_seed()
    silver = {
        "silver_crm_customers": [c.model_dump(mode="json") for c in seed.customers],
        "silver_invoices": [i.model_dump(mode="json") for i in seed.invoices],
    }
    for table, rows in silver.items():
        pq.write_table(pa.Table.from_pylist(rows), tmp_path / f"{table}.parquet")

    customers = pq.read_table(tmp_path / "silver_crm_customers.parquet").to_pylist()
    invoices = pq.read_table(tmp_path / "silver_invoices.parquet").to_pylist()

    assert len(customers) == 3
    assert len(invoices) == 2
    assert customers[0]["customer_code"] == "C001"
    # JSON-mode dumps serialize Decimal as str; the parquet file round-trips it
    assert invoices[0]["total"] == "550"

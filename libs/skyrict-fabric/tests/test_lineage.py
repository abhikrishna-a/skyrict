"""Tests for column-level lineage completeness."""
from __future__ import annotations

from skyrict_fabric.lineage import LINEAGE_REGISTRY

SOURCE_TABLES = [
    "erp_currencies", "erp_crm_leads", "erp_crm_opportunities",
    "erp_crm_customers", "erp_sales_orders", "erp_sales_order_lines",
    "erp_invoices", "erp_payments", "erp_journal_lines", "erp_products",
]

class TestLineageCompleteness:
    def test_all_source_tables_covered(self) -> None:
        covered = {e.bronze_table for e in LINEAGE_REGISTRY}
        for table in SOURCE_TABLES:
            assert table in covered, f"{table} not in lineage"

    def test_silver_columns_covered(self) -> None:
        silver_tables = {e.silver_table for e in LINEAGE_REGISTRY}
        assert len(silver_tables) >= 10

    def test_money_columns_have_currency(self) -> None:
        money_cols = {"amount", "total", "subtotal", "debit", "credit",
                       "cost_price", "sell_price", "line_total", "unit_price",
                       "payment_total"}
        for entry in LINEAGE_REGISTRY:
            if entry.bronze_column in money_cols and entry.gold_table is None:
                # Check there is a coalesce transform or currency companion
                assert entry.transform in ("numeric_18_4", "sum_aggregate") or \
                       "currency" in entry.bronze_column, \
                       f"Money col {entry.bronze_column} without currency companion"

    def test_gold_keys_have_lineage(self) -> None:
        gold_keys = {e.gold_column for e in LINEAGE_REGISTRY if e.gold_column}
        assert "customer_key" in gold_keys
        assert "product_key" in gold_keys
        assert "deal_key" in gold_keys
        assert "revenue_key" in gold_keys
        assert "pipeline_key" in gold_keys

    def test_no_duplicate_bronze_columns(self) -> None:
        seen = set()
        for e in LINEAGE_REGISTRY:
            key = (e.bronze_table, e.bronze_column, e.silver_table, e.silver_column, e.gold_table, e.gold_column)
            assert key not in seen, f"Duplicate lineage entry: {key}"
            seen.add(key)

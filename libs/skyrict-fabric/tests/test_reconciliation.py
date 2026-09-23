"""Tests for Gold parity reconciliation against the canonical seed."""

from __future__ import annotations

from decimal import Decimal

from skyrict_fabric.reconciliation import reconcile_totals
from skyrict_fabric.seed import build_gold_from_seed, build_seed


class TestReconcileSeed:
    def test_seed_parity_passes(self) -> None:
        seed = build_seed()
        gold = build_gold_from_seed(seed)
        results = reconcile_totals(
            gold["fact_deals"],
            gold["fact_revenue"],
            gold["fact_pipeline"],
            gold["dim_customer"],
            seed.expected,
        )
        assert len(results) == len(seed.expected)
        assert all(r.passed for r in results), [
            (r.table, r.metric, r.currency, r.expected, r.actual) for r in results if not r.passed
        ]

    def test_amount_delta_fails(self) -> None:
        seed = build_seed()
        gold = build_gold_from_seed(seed)
        expected = dict(seed.expected)
        expected["fact_deals.amount.USD"] = Decimal("999")
        results = reconcile_totals(
            gold["fact_deals"],
            gold["fact_revenue"],
            gold["fact_pipeline"],
            gold["dim_customer"],
            expected,
        )
        failed = [r for r in results if not r.passed]
        assert len(failed) == 1
        assert failed[0].table == "fact_deals"
        assert failed[0].metric == "amount"
        assert failed[0].currency == "USD"
        assert failed[0].expected == Decimal("999")
        assert failed[0].actual == Decimal("1000")

    def test_count_delta_fails(self) -> None:
        seed = build_seed()
        gold = build_gold_from_seed(seed)
        expected = dict(seed.expected)
        expected["dim_customer.count"] = 4
        results = reconcile_totals(
            gold["fact_deals"],
            gold["fact_revenue"],
            gold["fact_pipeline"],
            gold["dim_customer"],
            expected,
        )
        failed = [r for r in results if not r.passed]
        assert len(failed) == 1
        assert failed[0].table == "dim_customer"
        assert failed[0].metric == "count"

    def test_currencies_never_cross_summed(self) -> None:
        seed = build_seed()
        gold = build_gold_from_seed(seed)
        # USD total must NOT include the EUR deal
        expected = dict(seed.expected)
        expected["fact_deals.amount.USD"] = Decimal("1000")
        results = reconcile_totals(
            gold["fact_deals"],
            gold["fact_revenue"],
            gold["fact_pipeline"],
            gold["dim_customer"],
            expected,
        )
        usd = next(r for r in results if r.table == "fact_deals" and r.currency == "USD")
        assert usd.actual == Decimal("1000")

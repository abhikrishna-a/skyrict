"""Gold parity reconciliation: Gold totals must match seeded source totals.

Every monetary comparison is **per-currency** -- never a cross-currency SUM.
The expected totals are the canonical seeded values that BI-PBI-001 later
compares its measure values against (parity check).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from skyrict_fabric.money import quantize_money

if TYPE_CHECKING:
    from collections.abc import Sequence

    from skyrict_fabric.schema import (
        GoldDimCustomer,
        GoldFactDeals,
        GoldFactPipeline,
        GoldFactRevenue,
    )

__all__ = ["ReconciliationResult", "reconcile_totals"]


@dataclass(frozen=True)
class ReconciliationResult:
    """One parity check: expected vs actual for a table/metric/currency."""

    table: str
    metric: str
    currency: str | None
    expected: Decimal
    actual: Decimal
    passed: bool


def _sum_by_currency(
    facts: Sequence[GoldFactDeals | GoldFactRevenue | GoldFactPipeline],
    amount_attr: str,
) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for f in facts:
        amount = getattr(f, amount_attr)
        if amount is None:
            continue
        currency = f.currency_code or "USD"
        totals[currency] = totals.get(currency, Decimal("0")) + amount
    return {c: quantize_money(v) for c, v in totals.items()}


def reconcile_totals(
    fact_deals: Sequence[GoldFactDeals],
    fact_revenue: Sequence[GoldFactRevenue],
    fact_pipeline: Sequence[GoldFactPipeline],
    dim_customer: dict[str, GoldDimCustomer] | dict[object, GoldDimCustomer],
    expected: dict[str, Decimal | int],
) -> list[ReconciliationResult]:
    """Compare Gold aggregates against *expected* seeded totals.

    ``expected`` keys are ``"<table>.<metric>"`` where metric is one of
    ``amount`` (per-currency SUM) or ``count`` (row count).  Per-currency
    expectations use ``"<table>.amount.<CURRENCY>"``.
    """
    results: list[ReconciliationResult] = []

    def check(
        table: str, metric: str, currency: str | None, expected: Decimal, actual: Decimal
    ) -> None:
        results.append(
            ReconciliationResult(
                table=table,
                metric=metric,
                currency=currency,
                expected=expected,
                actual=actual,
                passed=actual == expected,
            )
        )

    deals_by_ccy = _sum_by_currency(fact_deals, "amount")
    revenue_by_ccy = _sum_by_currency(fact_revenue, "total")
    pipeline_by_ccy = _sum_by_currency(fact_pipeline, "amount")

    for key, exp in expected.items():
        parts = key.split(".")
        table, metric = parts[0], parts[1]
        currency = parts[2] if len(parts) > 2 else None
        exp_dec = Decimal(str(exp))
        if metric == "count":
            if table == "fact_deals":
                actual = Decimal(len(fact_deals))
            elif table == "fact_revenue":
                actual = Decimal(len(fact_revenue))
            elif table == "fact_pipeline":
                actual = Decimal(len(fact_pipeline))
            elif table == "dim_customer":
                actual = Decimal(len(dim_customer))
            else:
                continue
            check(table, metric, currency, exp_dec, actual)
        elif metric == "amount":
            if table == "fact_deals":
                actual = deals_by_ccy.get(currency or "USD", Decimal("0"))
            elif table == "fact_revenue":
                actual = revenue_by_ccy.get(currency or "USD", Decimal("0"))
            elif table == "fact_pipeline":
                actual = pipeline_by_ccy.get(currency or "USD", Decimal("0"))
            else:
                continue
            check(table, metric, currency, exp_dec, actual)

    return results

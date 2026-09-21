"""Deterministic seed data for Gold parity reconciliation.

Fixed UUIDs and amounts so the expected totals are reproducible.  This is the
canonical seed that BI-PBI-001 later compares its measure values against.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from skyrict_fabric.schema import (
    SilverCrmCustomers,
    SilverCrmOpportunities,
    SilverInvoices,
    SilverPayments,
    SilverProducts,
)

__all__ = ["SeedData", "build_seed"]

TID_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TID_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
OWNER_1 = uuid.UUID("33333333-3333-3333-3333-333333333333")
OWNER_2 = uuid.UUID("44444444-4444-4444-4444-444444444444")
CUST_1 = uuid.UUID("55555555-5555-5555-5555-555555555555")
CUST_2 = uuid.UUID("66666666-6666-6666-6666-666666666666")
PROD_1 = uuid.UUID("77777777-7777-7777-7777-777777777777")
PROD_2 = uuid.UUID("88888888-8888-8888-8888-888888888888")
OPP_1 = uuid.UUID("99999999-9999-9999-9999-999999999999")
OPP_2 = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
OPP_3 = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
OPP_4 = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
INV_1 = uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")
INV_2 = uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
PAY_1 = uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")

NOW = datetime(2026, 9, 21, 12, 0, 0)


@dataclass(frozen=True)
class SeedData:
    """Silver inputs plus the expected Gold totals they must produce."""

    customers: list[SilverCrmCustomers] = field(default_factory=list)
    products: list[SilverProducts] = field(default_factory=list)
    opportunities: list[SilverCrmOpportunities] = field(default_factory=list)
    invoices: list[SilverInvoices] = field(default_factory=list)
    payments: list[SilverPayments] = field(default_factory=list)
    expected: dict[str, Decimal | int] = field(default_factory=dict)


def build_seed() -> SeedData:
    """Return the canonical deterministic seed (2 tenants, 2 currencies)."""
    customers = [
        SilverCrmCustomers(
            tenant_id=TID_A,
            id=CUST_1,
            customer_code="C001",
            name="Acme",
            credit_limit=Decimal("50000"),
            currency_code="USD",
            is_active=True,
            created_at=NOW,
            updated_at=NOW,
        ),
        SilverCrmCustomers(
            tenant_id=TID_A,
            id=CUST_2,
            customer_code="C002",
            name="Globex",
            credit_limit=Decimal("100000"),
            currency_code="EUR",
            is_active=True,
            created_at=NOW,
            updated_at=NOW,
        ),
        SilverCrmCustomers(
            tenant_id=TID_B,
            id=uuid.uuid5(uuid.NAMESPACE_DNS, "cust-b1"),
            customer_code="C003",
            name="Initech",
            credit_limit=Decimal("25000"),
            currency_code="USD",
            is_active=False,
            created_at=NOW,
            updated_at=NOW,
        ),
    ]
    products = [
        SilverProducts(
            tenant_id=TID_A,
            id=PROD_1,
            sku="SKU-001",
            name="Widget",
            cost_price=Decimal("10"),
            cost_currency_code="USD",
            sell_price=Decimal("25"),
            sell_currency_code="USD",
            is_active=True,
            created_at=NOW,
            updated_at=NOW,
        ),
        SilverProducts(
            tenant_id=TID_A,
            id=PROD_2,
            sku="SKU-002",
            name="Gadget",
            cost_price=Decimal("20"),
            cost_currency_code="EUR",
            sell_price=Decimal("50"),
            sell_currency_code="EUR",
            is_active=True,
            created_at=NOW,
            updated_at=NOW,
        ),
    ]
    opportunities = [
        # Won deals (fact_deals): 1000 USD + 2000 EUR
        SilverCrmOpportunities(
            tenant_id=TID_A,
            id=OPP_1,
            name="Deal A",
            stage="won",
            amount=Decimal("1000"),
            currency_code="USD",
            probability=100,
            owner_id=OWNER_1,
            won_at=NOW,
            created_at=NOW,
            updated_at=NOW,
        ),
        SilverCrmOpportunities(
            tenant_id=TID_A,
            id=OPP_2,
            name="Deal B",
            stage="won",
            amount=Decimal("2000"),
            currency_code="EUR",
            probability=100,
            owner_id=OWNER_2,
            won_at=NOW,
            created_at=NOW,
            updated_at=NOW,
        ),
        # Lost (excluded from both facts)
        SilverCrmOpportunities(
            tenant_id=TID_A,
            id=OPP_3,
            name="Deal C",
            stage="lost",
            amount=Decimal("500"),
            currency_code="USD",
            probability=0,
            owner_id=OWNER_1,
            lost_at=NOW,
            created_at=NOW,
            updated_at=NOW,
        ),
        # Active pipeline (fact_pipeline): 3000 USD, NULL owner -> sentinel
        SilverCrmOpportunities(
            tenant_id=TID_A,
            id=OPP_4,
            name="Deal D",
            stage="negotiation",
            amount=Decimal("3000"),
            currency_code="USD",
            probability=60,
            owner_id=None,
            created_at=NOW,
            updated_at=NOW,
        ),
    ]
    invoices = [
        SilverInvoices(
            tenant_id=TID_A,
            id=INV_1,
            invoice_number="INV-001",
            customer_id=CUST_1,
            invoice_date=date(2026, 1, 15),
            due_date=date(2026, 2, 15),
            status="approved",
            total=Decimal("550"),
            currency_code="USD",
            created_at=NOW,
            updated_at=NOW,
        ),
        SilverInvoices(
            tenant_id=TID_A,
            id=INV_2,
            invoice_number="INV-002",
            customer_id=CUST_2,
            invoice_date=date(2026, 2, 1),
            due_date=date(2026, 3, 1),
            status="paid",
            total=Decimal("1200"),
            currency_code="EUR",
            created_at=NOW,
            updated_at=NOW,
        ),
    ]
    payments = [
        SilverPayments(
            tenant_id=TID_A,
            id=PAY_1,
            payment_number="PAY-001",
            invoice_id=INV_1,
            amount=Decimal("300"),
            currency_code="USD",
            method="bank",
            status="completed",
            created_at=NOW,
            updated_at=NOW,
        ),
    ]
    expected: dict[str, Decimal | int] = {
        "fact_deals.count": 2,
        "fact_deals.amount.USD": Decimal("1000"),
        "fact_deals.amount.EUR": Decimal("2000"),
        "fact_revenue.count": 2,
        "fact_revenue.amount.USD": Decimal("550"),
        "fact_revenue.amount.EUR": Decimal("1200"),
        "fact_pipeline.count": 1,
        "fact_pipeline.amount.USD": Decimal("3000"),
        "dim_customer.count": 3,
    }
    return SeedData(
        customers=customers,
        products=products,
        opportunities=opportunities,
        invoices=invoices,
        payments=payments,
        expected=expected,
    )


def build_gold_from_seed(seed: SeedData) -> dict[str, Any]:
    """Run the Gold builders over the seed and return the assembled outputs."""
    from skyrict_fabric.gold import (
        build_dim_customer,
        build_dim_product,
        build_dim_rep,
        build_fact_deals,
        build_fact_pipeline,
        build_fact_revenue,
    )

    dim_customer = build_dim_customer(seed.customers)
    dim_product = build_dim_product(seed.products)
    dim_rep = build_dim_rep(seed.opportunities)
    fact_deals = build_fact_deals(seed.opportunities, dim_customer)
    fact_revenue = build_fact_revenue(seed.invoices, seed.payments, dim_customer)
    fact_pipeline = build_fact_pipeline(seed.opportunities)
    return {
        "dim_customer": dim_customer,
        "dim_product": dim_product,
        "dim_rep": dim_rep,
        "fact_deals": fact_deals,
        "fact_revenue": fact_revenue,
        "fact_pipeline": fact_pipeline,
    }

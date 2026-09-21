"""Tests for Silver-to-Gold star schema assembly."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from skyrict_fabric.gold import (
    build_dim_customer,
    build_dim_date,
    build_dim_product,
    build_dim_rep,
    build_fact_deals,
    build_fact_pipeline,
    build_fact_revenue,
)
from skyrict_fabric.schema import (
    SilverCrmCustomers,
    SilverCrmOpportunities,
    SilverInvoices,
    SilverPayments,
    SilverProducts,
)
from skyrict_fabric.tenant import make_tenant_key

TID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OWNER = uuid.UUID("22222222-2222-2222-2222-222222222222")
CUST_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
PROD_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
INV_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
NOW = datetime(2026, 9, 21, 12, 0, 0)

def _cust_model(**kw: object) -> SilverCrmCustomers:
    defaults = {
        "tenant_id": TID, "id": CUST_ID, "customer_code": "C001", "name": "Acme",
        "credit_limit": Decimal("50000"), "currency_code": "USD",
        "is_active": True, "created_at": NOW, "updated_at": NOW,
    }
    defaults.update(kw)
    return SilverCrmCustomers(**defaults)

def _opp_model(**kw: object) -> SilverCrmOpportunities:
    defaults = {
        "tenant_id": TID, "id": uuid.uuid4(), "name": "Deal", "stage": "won",
        "amount": Decimal("10000"), "currency_code": "USD",
        "owner_id": OWNER, "probability": 80,
        "created_at": NOW, "updated_at": NOW,
    }
    defaults.update(kw)
    return SilverCrmOpportunities(**defaults)

def _prod_model(**kw: object) -> SilverProducts:
    defaults = {
        "tenant_id": TID, "id": PROD_ID, "sku": "SKU-001", "name": "Widget",
        "cost_price": Decimal("10"), "cost_currency_code": "USD",
        "sell_price": Decimal("25"), "sell_currency_code": "USD",
        "is_active": True, "created_at": NOW, "updated_at": NOW,
    }
    defaults.update(kw)
    return SilverProducts(**defaults)

def _inv_model(**kw: object) -> SilverInvoices:
    defaults = {
        "tenant_id": TID, "id": INV_ID, "invoice_number": "INV-001",
        "customer_id": CUST_ID, "invoice_date": date(2026, 1, 15),
        "due_date": date(2026, 2, 15), "status": "approved",
        "total": Decimal("550"), "currency_code": "USD",
        "created_at": NOW, "updated_at": NOW,
    }
    defaults.update(kw)
    return SilverInvoices(**defaults)

class TestDimCustomer:
    def test_scd1_latest_wins(self) -> None:
        c1 = _cust_model(updated_at=datetime(2026, 1, 1))
        c2 = _cust_model(updated_at=datetime(2026, 6, 1))
        dim = build_dim_customer([c1, c2])
        assert len(dim) == 1
        key = make_tenant_key(TID, CUST_ID)
        assert dim[key].last_updated_at == datetime(2026, 6, 1)

class TestDimProduct:
    def test_deduplication(self) -> None:
        p1 = _prod_model(updated_at=datetime(2026, 1, 1))
        p2 = _prod_model(updated_at=datetime(2026, 6, 1))
        dim = build_dim_product([p1, p2])
        assert len(dim) == 1

class TestDimDate:
    def test_completeness(self) -> None:
        dim = build_dim_date(date(2026, 1, 1), date(2026, 1, 5))
        assert len(dim) == 5
        assert 20260101 in dim
        assert 20260105 in dim
    def test_weekend_flag(self) -> None:
        dim = build_dim_date(date(2026, 1, 3), date(2026, 1, 3))  # Saturday
        assert dim[20260103].is_weekend is True

class TestDimRep:
    def test_unique_owners(self) -> None:
        o1 = _opp_model(owner_id=OWNER)
        o2 = _opp_model(owner_id=OWNER)  # same owner
        reps = build_dim_rep([o1, o2])
        assert len(reps) == 1

class TestFactDeals:
    def test_won_only(self) -> None:
        o1 = _opp_model(stage="won")
        o2 = _opp_model(stage="prospecting")
        facts = build_fact_deals([o1, o2], {})
        assert len(facts) == 1
        assert facts[0].stage == "won"
    def test_no_fan_out(self) -> None:
        o = _opp_model()
        facts = build_fact_deals([o], {})
        assert len(facts) == 1

class TestFactRevenue:
    def test_payment_aggregation(self) -> None:
        inv = _inv_model()
        pay = SilverPayments(
            tenant_id=TID, id=uuid.uuid4(), payment_number="P1",
            invoice_id=INV_ID, amount=Decimal("300"), currency_code="USD",
            method="bank", status="completed", created_at=NOW, updated_at=NOW,
        )
        facts = build_fact_revenue([inv], [pay], {})
        assert len(facts) == 1
        assert facts[0].payment_total == Decimal("300.0000")
        assert facts[0].payment_count == 1
    def test_excludes_draft(self) -> None:
        inv = _inv_model(status="draft")
        facts = build_fact_revenue([inv], [], {})
        assert len(facts) == 0

class TestFactPipeline:
    def test_excludes_terminal(self) -> None:
        o1 = _opp_model(stage="won")
        o2 = _opp_model(stage="lost")
        o3 = _opp_model(stage="negotiation")
        facts = build_fact_pipeline([o1, o2, o3])
        assert len(facts) == 1
        assert facts[0].stage == "negotiation"

class TestMoneyNeverFloat:
    def test_deals_money(self) -> None:
        o = _opp_model(amount=Decimal("9999.99"))
        facts = build_fact_deals([o], {})
        assert isinstance(facts[0].amount, Decimal)
    def test_revenue_money(self) -> None:
        inv = _inv_model(total=Decimal("9999.99"))
        facts = build_fact_revenue([inv], [], {})
        assert isinstance(facts[0].total, Decimal)
    def test_pipeline_money(self) -> None:
        o = _opp_model(stage="negotiation", amount=Decimal("9999.99"))
        facts = build_fact_pipeline([o])
        assert isinstance(facts[0].amount, Decimal)

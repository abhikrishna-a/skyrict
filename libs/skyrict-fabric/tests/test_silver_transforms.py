"""Tests for Bronze-to-Silver transform functions."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from skyrict_fabric.silver import (
    transform_crm_customers,
    transform_crm_leads,
    transform_crm_opportunities,
    transform_currencies,
    transform_invoices,
    transform_payments,
    transform_sales_orders,
)

TID = uuid.UUID("11111111-1111-1111-1111-111111111111")
NOW = datetime(2026, 9, 21, 12, 0, 0)

def _lead(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "status": "New", "source": "Website",
        "first_name": "  Alice  ", "last_name": "  Smith  ",
        "email": "alice@example.com", "phone": "+1-555-0100",
        "company": "Acme", "owner_id": str(uuid.uuid4()),
        "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

def _opp(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "name": "Deal A", "stage": "Won",
        "amount": "1250.56789", "currency_code": "EUR",
        "probability": 80, "owner_id": str(uuid.uuid4()),
        "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

def _cust(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "customer_code": "CUST-001", "name": "Acme Corp",
        "credit_limit": "50000.50", "currency_code": "GBP",
        "is_active": True, "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

def _order(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "order_number": "ORD-001", "customer_id": str(uuid.uuid4()),
        "status": "confirmed", "subtotal": "1000", "discount": "50",
        "tax": "100", "total": "1050", "currency_code": "USD",
        "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

def _inv(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "invoice_number": "INV-001", "customer_id": str(uuid.uuid4()),
        "invoice_date": "2026-01-15", "due_date": "2026-02-15",
        "status": "approved", "subtotal": "500", "tax": "50",
        "total": "550", "currency_code": "USD",
        "exchange_rate": "1", "source": "manual",
        "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

def _pay(**overrides: object) -> dict:
    base = {
        "tenant_id": str(TID), "id": str(uuid.uuid4()),
        "payment_number": "PAY-001", "invoice_id": str(uuid.uuid4()),
        "amount": "550", "currency_code": "USD",
        "method": "bank_transfer", "status": "completed",
        "source": "manual", "created_at": NOW, "updated_at": NOW,
    }
    base.update(overrides)
    return base

class TestTransformCrmLeads:
    def test_happy_path(self) -> None:
        row = _lead()
        result = transform_crm_leads(row)
        assert result.tenant_id == TID
        assert result.status == "new"
        assert result.source == "website"
    def test_enum_normalized(self) -> None:
        result = transform_crm_leads(_lead(status="Qualified"))
        assert result.status == "qualified"
    def test_strings_trimmed(self) -> None:
        result = transform_crm_leads(_lead())
        assert result.first_name == "Alice"
        assert result.last_name == "Smith"
    def test_none_owner(self) -> None:
        result = transform_crm_leads(_lead(owner_id=None))
        assert result.owner_id is None

class TestTransformCrmOpportunities:
    def test_money_normalized(self) -> None:
        result = transform_crm_opportunities(_opp())
        assert isinstance(result.amount, Decimal)
        assert result.amount == Decimal("1250.5679")
    def test_currency_coalesced(self) -> None:
        result = transform_crm_opportunities(_opp())
        assert result.currency_code == "EUR"
    def test_no_amount_no_currency(self) -> None:
        result = transform_crm_opportunities(_opp(amount=None, currency_code=None))
        assert result.amount is None
        assert result.currency_code is None
    def test_stage_normalized(self) -> None:
        result = transform_crm_opportunities(_opp(stage="Negotiation"))
        assert result.stage == "negotiation"

class TestTransformCrmCustomers:
    def test_happy_path(self) -> None:
        result = transform_crm_customers(_cust())
        assert result.customer_code == "CUST-001"
        assert result.name == "Acme Corp"
        assert result.credit_limit == Decimal("50000.5000")
    def test_currency_coalesced(self) -> None:
        result = transform_crm_customers(_cust())
        assert result.currency_code == "GBP"

class TestTransformSalesOrders:
    def test_money_fields(self) -> None:
        result = transform_sales_orders(_order())
        assert result.subtotal == Decimal("1000.0000")
        assert result.total == Decimal("1050.0000")

class TestTransformInvoices:
    def test_money_fields(self) -> None:
        result = transform_invoices(_inv())
        assert result.total == Decimal("550.0000")
        assert result.invoice_date == date(2026, 1, 15)
    def test_status_normalized(self) -> None:
        result = transform_invoices(_inv(status="Paid"))
        assert result.status == "paid"

class TestTransformPayments:
    def test_amount_money(self) -> None:
        result = transform_payments(_pay())
        assert result.amount == Decimal("550.0000")

class TestTransformCurrencies:
    def test_happy_path(self) -> None:
        result = transform_currencies({"code": "usd", "name": "US Dollar", "symbol": "$"})
        assert result.code == "USD"
        assert result.name == "US Dollar"
        assert result.is_active is True

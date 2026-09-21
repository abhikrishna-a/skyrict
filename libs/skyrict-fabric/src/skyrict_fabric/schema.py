"""Pydantic models for Silver and Gold medallion tables."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

__all__ = [
    "GoldDimCustomer",
    "GoldDimDate",
    "GoldDimProduct",
    "GoldDimRep",
    "GoldFactDeals",
    "GoldFactPipeline",
    "GoldFactRevenue",
    "SilverCrmCustomers",
    "SilverCrmLeads",
    "SilverCrmOpportunities",
    "SilverCurrencies",
    "SilverInvoices",
    "SilverJournalLines",
    "SilverPayments",
    "SilverProducts",
    "SilverSalesOrderLines",
    "SilverSalesOrders",
]

class SilverCurrencies(BaseModel):
    code: str = Field(..., max_length=3)
    name: str = Field(..., max_length=100)
    symbol: str = Field(default="", max_length=10)
    decimal_places: int = Field(default=2, ge=0, le=10)
    is_active: bool = True

class SilverCrmLeads(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    status: str = "new"
    source: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    owner_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

class SilverCrmOpportunities(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    name: str
    lead_id: uuid.UUID | None = None
    stage: str = "prospecting"
    amount: Decimal | None = None
    currency_code: str | None = None
    probability: int = 0
    expected_close_date: date | None = None
    owner_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    won_at: datetime | None = None
    lost_at: datetime | None = None
    lost_reason: str | None = None
    created_at: datetime
    updated_at: datetime

class SilverCrmCustomers(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    customer_code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    email: str | None = None
    phone: str | None = None
    credit_limit: Decimal = Decimal("0")
    currency_code: str = "USD"
    is_active: bool = True
    source_opportunity_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

class SilverSalesOrders(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    order_number: str = Field(..., max_length=64)
    customer_id: uuid.UUID
    status: str = "draft"
    subtotal: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    tax: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    currency_code: str = "USD"
    order_date: date | None = None
    created_at: datetime
    updated_at: datetime

class SilverSalesOrderLines(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    order_id: uuid.UUID
    product_id: uuid.UUID
    quantity: int = 0
    unit_price: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    tax: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    currency_code: str = "USD"
    created_at: datetime
    updated_at: datetime

class SilverInvoices(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    invoice_number: str = Field(..., max_length=64)
    customer_id: uuid.UUID
    order_id: uuid.UUID | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    status: str = "draft"
    subtotal: Decimal = Decimal("0")
    tax: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    currency_code: str = "USD"
    exchange_rate: Decimal = Decimal("1")
    source: str = "manual"
    source_ref: str | None = None
    created_at: datetime
    updated_at: datetime

class SilverPayments(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    payment_number: str = Field(..., max_length=64)
    invoice_id: uuid.UUID
    customer_id: uuid.UUID | None = None
    amount: Decimal = Decimal("0")
    currency_code: str = "USD"
    method: str = "other"
    status: str = "pending"
    payment_date: date | None = None
    source: str = "manual"
    source_ref: str | None = None
    created_at: datetime
    updated_at: datetime

class SilverJournalLines(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    entry_id: uuid.UUID
    account_id: uuid.UUID
    description: str | None = None
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    currency_code: str = "USD"
    exchange_rate: Decimal = Decimal("1")
    created_at: datetime
    updated_at: datetime

class SilverProducts(BaseModel):
    tenant_id: uuid.UUID
    id: uuid.UUID
    sku: str = Field(..., max_length=128)
    name: str = Field(..., max_length=255)
    description: str | None = None
    cost_price: Decimal = Decimal("0")
    cost_currency_code: str = "USD"
    sell_price: Decimal = Decimal("0")
    sell_currency_code: str = "USD"
    is_active: bool = True
    reorder_point: int = 0
    supplier_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

class GoldDimCustomer(BaseModel):
    customer_key: uuid.UUID
    tenant_id: uuid.UUID
    source_customer_id: uuid.UUID
    customer_code: str
    name: str
    email: str | None = None
    phone: str | None = None
    credit_limit: Decimal = Decimal("0")
    credit_currency: str = "USD"
    is_active: bool = True
    source_opportunity_id: uuid.UUID | None = None
    first_seen_at: datetime
    last_updated_at: datetime

class GoldDimProduct(BaseModel):
    product_key: uuid.UUID
    tenant_id: uuid.UUID
    source_product_id: uuid.UUID
    sku: str
    name: str
    description: str | None = None
    cost_price: Decimal = Decimal("0")
    cost_currency: str = "USD"
    sell_price: Decimal = Decimal("0")
    sell_currency: str = "USD"
    is_active: bool = True
    first_seen_at: datetime
    last_updated_at: datetime

class GoldDimDate(BaseModel):
    date_key: int = Field(..., description="YYYYMMDD integer")
    date_value: date
    year: int
    month: int
    day: int
    quarter: int
    month_name: str
    day_of_week: str
    is_weekend: bool
    fiscal_year: int | None = None

class GoldDimRep(BaseModel):
    rep_key: uuid.UUID
    tenant_id: uuid.UUID
    source_owner_id: uuid.UUID
    first_seen_at: datetime
    last_updated_at: datetime

class GoldFactDeals(BaseModel):
    deal_key: uuid.UUID
    tenant_id: uuid.UUID
    source_opportunity_id: uuid.UUID
    customer_key: uuid.UUID | None = None
    rep_key: uuid.UUID | None = None
    won_date_key: int | None = None
    created_date_key: int = 0
    opportunity_name: str
    stage: str
    amount: Decimal | None = None
    currency_code: str | None = None
    probability: int = 0
    won_at: datetime | None = None
    lead_source: str | None = None
    created_at: datetime
    updated_at: datetime

class GoldFactRevenue(BaseModel):
    revenue_key: uuid.UUID
    tenant_id: uuid.UUID
    source_invoice_id: uuid.UUID
    customer_key: uuid.UUID | None = None
    invoice_date_key: int = 0
    due_date_key: int = 0
    invoice_number: str
    status: str
    total: Decimal = Decimal("0")
    currency_code: str = "USD"
    payment_total: Decimal = Decimal("0")
    payment_count: int = 0
    is_paid: bool = False
    created_at: datetime
    updated_at: datetime

class GoldFactPipeline(BaseModel):
    pipeline_key: uuid.UUID
    tenant_id: uuid.UUID
    source_opportunity_id: uuid.UUID
    rep_key: uuid.UUID | None = None
    created_date_key: int = 0
    expected_close_date_key: int | None = None
    opportunity_name: str
    stage: str
    amount: Decimal | None = None
    currency_code: str | None = None
    probability: int = 0
    days_in_stage: int = 0
    created_at: datetime
    updated_at: datetime

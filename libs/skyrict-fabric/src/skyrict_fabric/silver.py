"""Bronze-to-Silver transform functions."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from skyrict_fabric.money import coalesce_currency, validate_money
from skyrict_fabric.schema import (
    SilverCrmCustomers,
    SilverCrmLeads,
    SilverCrmOpportunities,
    SilverCurrencies,
    SilverInvoices,
    SilverJournalLines,
    SilverPayments,
    SilverProducts,
    SilverSalesOrderLines,
    SilverSalesOrders,
)

__all__ = [
    "transform_crm_customers",
    "transform_crm_leads",
    "transform_crm_opportunities",
    "transform_currencies",
    "transform_invoices",
    "transform_journal_lines",
    "transform_payments",
    "transform_products",
    "transform_sales_order_lines",
    "transform_sales_orders",
]

def _safe_str(val: Any, max_len: int | None = None) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    return s[:max_len] if max_len else s

def _safe_uuid(val: Any) -> uuid.UUID | None:
    if val is None:
        return None
    try:
        return uuid.UUID(str(val))
    except (ValueError, AttributeError):
        return None

def _safe_datetime(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None

def _safe_date(val: Any) -> date | None:
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, str):
        try:
            return date.fromisoformat(val)
        except ValueError:
            return None
    return None

def _norm_enum(val: Any, default: str = "") -> str:
    if val is None:
        return default
    return str(val).strip().lower()

_NIL = uuid.UUID("00000000-0000-0000-0000-000000000000")
_MIN = datetime.min

def transform_currencies(row: dict[str, Any]) -> SilverCurrencies:
    return SilverCurrencies(
        code=str(row["code"]).strip().upper(),
        name=str(row["name"]).strip(),
        symbol=_safe_str(row.get("symbol"), 10) or "",
        decimal_places=int(row.get("decimal_places", 2)),
        is_active=bool(row.get("is_active", True)),
    )

def transform_crm_leads(row: dict[str, Any]) -> SilverCrmLeads:
    return SilverCrmLeads(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        status=_norm_enum(row.get("status"), "new"),
        source=_norm_enum(row.get("source")),
        first_name=_safe_str(row.get("first_name"), 100),
        last_name=_safe_str(row.get("last_name"), 100),
        email=_safe_str(row.get("email"), 255),
        phone=_safe_str(row.get("phone"), 32),
        company=_safe_str(row.get("company"), 255),
        owner_id=_safe_uuid(row.get("owner_id")),
        team_id=_safe_uuid(row.get("team_id")),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_crm_opportunities(row: dict[str, Any]) -> SilverCrmOpportunities:
    amount_raw = row.get("amount")
    amount = validate_money(amount_raw, "amount") if amount_raw is not None else None
    currency = coalesce_currency(row.get("currency_code")) if amount is not None else None
    return SilverCrmOpportunities(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        name=str(row["name"]).strip(),
        lead_id=_safe_uuid(row.get("lead_id")),
        stage=_norm_enum(row.get("stage"), "prospecting"),
        amount=amount,
        currency_code=currency,
        probability=int(row.get("probability", 0)),
        expected_close_date=_safe_date(row.get("expected_close_date")),
        owner_id=_safe_uuid(row.get("owner_id")),
        team_id=_safe_uuid(row.get("team_id")),
        won_at=_safe_datetime(row.get("won_at")),
        lost_at=_safe_datetime(row.get("lost_at")),
        lost_reason=_safe_str(row.get("lost_reason"), 255),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_crm_customers(row: dict[str, Any]) -> SilverCrmCustomers:
    return SilverCrmCustomers(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        customer_code=str(row["customer_code"]).strip(),
        name=str(row["name"]).strip(),
        email=_safe_str(row.get("email"), 255),
        phone=_safe_str(row.get("phone"), 32),
        credit_limit=validate_money(row.get("credit_limit"), "credit_limit"),
        currency_code=coalesce_currency(row.get("currency_code")),
        is_active=bool(row.get("is_active", True)),
        source_opportunity_id=_safe_uuid(row.get("source_opportunity_id")),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_sales_orders(row: dict[str, Any]) -> SilverSalesOrders:
    return SilverSalesOrders(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        order_number=str(row["order_number"]).strip(),
        customer_id=_safe_uuid(row["customer_id"]) or _NIL,
        status=_norm_enum(row.get("status"), "draft"),
        subtotal=validate_money(row.get("subtotal"), "subtotal"),
        discount=validate_money(row.get("discount"), "discount"),
        tax=validate_money(row.get("tax"), "tax"),
        total=validate_money(row.get("total"), "total"),
        currency_code=coalesce_currency(row.get("currency_code")),
        order_date=_safe_date(row.get("order_date")),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_sales_order_lines(row: dict[str, Any]) -> SilverSalesOrderLines:
    return SilverSalesOrderLines(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        order_id=_safe_uuid(row["order_id"]) or _NIL,
        product_id=_safe_uuid(row["product_id"]) or _NIL,
        quantity=int(row.get("quantity", 0)),
        unit_price=validate_money(row.get("unit_price"), "unit_price"),
        discount=validate_money(row.get("discount"), "discount"),
        tax=validate_money(row.get("tax"), "tax"),
        line_total=validate_money(row.get("line_total"), "line_total"),
        currency_code=coalesce_currency(row.get("currency_code")),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_invoices(row: dict[str, Any]) -> SilverInvoices:
    return SilverInvoices(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        invoice_number=str(row["invoice_number"]).strip(),
        customer_id=_safe_uuid(row["customer_id"]) or _NIL,
        order_id=_safe_uuid(row.get("order_id")),
        invoice_date=_safe_date(row.get("invoice_date")),
        due_date=_safe_date(row.get("due_date")),
        status=_norm_enum(row.get("status"), "draft"),
        subtotal=validate_money(row.get("subtotal"), "subtotal"),
        tax=validate_money(row.get("tax"), "tax"),
        total=validate_money(row.get("total"), "total"),
        currency_code=coalesce_currency(row.get("currency_code")),
        exchange_rate=validate_money(row.get("exchange_rate"), "exchange_rate"),
        source=_norm_enum(row.get("source"), "manual"),
        source_ref=_safe_str(row.get("source_ref"), 128),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_payments(row: dict[str, Any]) -> SilverPayments:
    return SilverPayments(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        payment_number=str(row["payment_number"]).strip(),
        invoice_id=_safe_uuid(row["invoice_id"]) or _NIL,
        customer_id=_safe_uuid(row.get("customer_id")),
        amount=validate_money(row.get("amount"), "amount"),
        currency_code=coalesce_currency(row.get("currency_code")),
        method=_norm_enum(row.get("method"), "other"),
        status=_norm_enum(row.get("status"), "pending"),
        payment_date=_safe_date(row.get("payment_date")),
        source=_norm_enum(row.get("source"), "manual"),
        source_ref=_safe_str(row.get("source_ref"), 128),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_journal_lines(row: dict[str, Any]) -> SilverJournalLines:
    return SilverJournalLines(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        entry_id=_safe_uuid(row["entry_id"]) or _NIL,
        account_id=_safe_uuid(row["account_id"]) or _NIL,
        description=_safe_str(row.get("description"), 500),
        debit=validate_money(row.get("debit"), "debit"),
        credit=validate_money(row.get("credit"), "credit"),
        currency_code=coalesce_currency(row.get("currency_code")),
        exchange_rate=validate_money(row.get("exchange_rate"), "exchange_rate"),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

def transform_products(row: dict[str, Any]) -> SilverProducts:
    return SilverProducts(
        tenant_id=_safe_uuid(row["tenant_id"]) or _NIL,
        id=_safe_uuid(row["id"]) or _NIL,
        sku=str(row["sku"]).strip(),
        name=str(row["name"]).strip(),
        description=_safe_str(row.get("description"), 1000),
        cost_price=validate_money(row.get("cost_price"), "cost_price"),
        cost_currency_code=coalesce_currency(row.get("cost_currency_code")),
        sell_price=validate_money(row.get("sell_price"), "sell_price"),
        sell_currency_code=coalesce_currency(row.get("sell_currency_code")),
        is_active=bool(row.get("is_active", True)),
        reorder_point=int(row.get("reorder_point", 0)),
        supplier_id=_safe_uuid(row.get("supplier_id")),
        created_at=_safe_datetime(row["created_at"]) or _MIN,
        updated_at=_safe_datetime(row["updated_at"]) or _MIN,
    )

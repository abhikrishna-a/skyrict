"""Silver-to-Gold star schema assembly."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from skyrict_fabric.money import quantize_money
from skyrict_fabric.schema import (
    GoldDimCustomer,
    GoldDimDate,
    GoldDimProduct,
    GoldDimRep,
    GoldFactDeals,
    GoldFactPipeline,
    GoldFactRevenue,
    SilverCrmCustomers,
    SilverCrmLeads,
    SilverCrmOpportunities,
    SilverInvoices,
    SilverPayments,
    SilverProducts,
)
from skyrict_fabric.tenant import make_date_key, make_tenant_key

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import date

__all__ = [
    "build_dim_customer",
    "build_dim_date",
    "build_dim_product",
    "build_dim_rep",
    "build_fact_deals",
    "build_fact_pipeline",
    "build_fact_revenue",
]

# Sentinel for unassigned sales reps: NIL UUID as source_owner_id, so facts
# with a NULL owner never dangle (dim_rep always contains one row per tenant).
_UNASSIGNED = uuid.UUID("00000000-0000-0000-0000-000000000000")
_MIN_DT = datetime.min

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_NAMES = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


def build_dim_customer(
    customers: Sequence[SilverCrmCustomers],
) -> dict[uuid.UUID, GoldDimCustomer]:
    """SCD-1: latest row (by updated_at) wins per customer_key."""
    dim: dict[uuid.UUID, GoldDimCustomer] = {}
    for c in customers:
        key = make_tenant_key(c.tenant_id, c.id)
        existing = dim.get(key)
        if existing and existing.last_updated_at >= c.updated_at:
            continue
        dim[key] = GoldDimCustomer(
            customer_key=key,
            tenant_id=c.tenant_id,
            source_customer_id=c.id,
            customer_code=c.customer_code,
            name=c.name,
            email=c.email,
            phone=c.phone,
            credit_limit=quantize_money(c.credit_limit),
            credit_currency=c.currency_code,
            is_active=c.is_active,
            source_opportunity_id=c.source_opportunity_id,
            first_seen_at=c.created_at,
            last_updated_at=c.updated_at,
        )
    return dim


def build_dim_product(
    products: Sequence[SilverProducts],
) -> dict[uuid.UUID, GoldDimProduct]:
    """SCD-1: latest row (by updated_at) wins per product_key."""
    dim: dict[uuid.UUID, GoldDimProduct] = {}
    for p in products:
        key = make_tenant_key(p.tenant_id, p.id)
        existing = dim.get(key)
        if existing and existing.last_updated_at >= p.updated_at:
            continue
        dim[key] = GoldDimProduct(
            product_key=key,
            tenant_id=p.tenant_id,
            source_product_id=p.id,
            sku=p.sku,
            name=p.name,
            description=p.description,
            cost_price=quantize_money(p.cost_price),
            cost_currency=p.cost_currency_code,
            sell_price=quantize_money(p.sell_price),
            sell_currency=p.sell_currency_code,
            is_active=p.is_active,
            first_seen_at=p.created_at,
            last_updated_at=p.updated_at,
        )
    return dim


def build_dim_date(start: date, end: date) -> dict[int, GoldDimDate]:
    """Generate one row per calendar date in [start, end]."""
    from datetime import timedelta

    dim: dict[int, GoldDimDate] = {}
    current = start
    while current <= end:
        dk = make_date_key(current)
        if dk not in dim:
            dow = _DAY_NAMES[current.weekday()]
            q = (current.month - 1) // 3 + 1
            dim[dk] = GoldDimDate(
                date_key=dk,
                date_value=current,
                year=current.year,
                month=current.month,
                day=current.day,
                quarter=q,
                month_name=_MONTH_NAMES[current.month],
                day_of_week=dow,
                is_weekend=current.weekday() >= 5,
                fiscal_year=current.year,
            )
        current += timedelta(days=1)
    return dim


def build_dim_rep(
    opportunities: Sequence[SilverCrmOpportunities],
    leads: Sequence[SilverCrmLeads] | None = None,
) -> dict[uuid.UUID, GoldDimRep]:
    """Unique owner_ids from opportunities and leads, plus one Unassigned sentinel per tenant."""
    owner_map: dict[uuid.UUID, tuple[uuid.UUID, uuid.UUID, datetime, datetime]] = {}
    tenants: set[uuid.UUID] = set()
    for opp in opportunities:
        tenants.add(opp.tenant_id)
        if opp.owner_id is None:
            continue
        tid = opp.tenant_id
        key = make_tenant_key(tid, opp.owner_id)
        if key not in owner_map:
            owner_map[key] = (opp.tenant_id, opp.owner_id, opp.created_at, opp.updated_at)
        else:
            _, oid, first, last = owner_map[key]
            owner_map[key] = (tid, oid, min(first, opp.created_at), max(last, opp.updated_at))
    if leads:
        for lead in leads:
            tenants.add(lead.tenant_id)
            if lead.owner_id is None:
                continue
            key = make_tenant_key(lead.tenant_id, lead.owner_id)
            if key not in owner_map:
                owner_map[key] = (lead.tenant_id, lead.owner_id, lead.created_at, lead.updated_at)
            else:
                _, oid, first, last = owner_map[key]
                owner_map[key] = (
                    lead.tenant_id,
                    oid,
                    min(first, lead.created_at),
                    max(last, lead.updated_at),
                )
    for tid in tenants:
        sentinel_key = make_tenant_key(tid, _UNASSIGNED)
        if sentinel_key not in owner_map:
            owner_map[sentinel_key] = (tid, _UNASSIGNED, _MIN_DT, _MIN_DT)
    return {
        rep_key: GoldDimRep(
            rep_key=rep_key,
            tenant_id=tid,
            source_owner_id=owner_id,
            first_seen_at=first,
            last_updated_at=last,
        )
        for rep_key, (tid, owner_id, first, last) in owner_map.items()
    }


def build_fact_deals(
    opportunities: Sequence[SilverCrmOpportunities],
    customers: dict[uuid.UUID, GoldDimCustomer],
    leads: Sequence[SilverCrmLeads] | None = None,
) -> list[GoldFactDeals]:
    """Won opportunities only. No fan-out: dict lookup, not JOIN."""
    opp_to_cust = {
        c.source_opportunity_id: ck for ck, c in customers.items() if c.source_opportunity_id
    }
    lead_source: dict[uuid.UUID, str | None] = {}
    if leads:
        for lead in leads:
            if lead.id:
                lead_source[lead.id] = lead.source
    facts = []
    for opp in opportunities:
        if opp.stage != "won":
            continue
        deal_key = make_tenant_key(opp.tenant_id, opp.id)
        customer_key = opp_to_cust.get(opp.id)
        rep_key = (
            make_tenant_key(opp.tenant_id, opp.owner_id)
            if opp.owner_id
            else make_tenant_key(opp.tenant_id, _UNASSIGNED)
        )
        won_date_key = make_date_key(opp.won_at) if opp.won_at else None
        created_date_key = make_date_key(opp.created_at)
        ls = lead_source.get(opp.lead_id) if opp.lead_id else None
        facts.append(
            GoldFactDeals(
                deal_key=deal_key,
                tenant_id=opp.tenant_id,
                source_opportunity_id=opp.id,
                customer_key=customer_key,
                rep_key=rep_key,
                won_date_key=won_date_key,
                created_date_key=created_date_key,
                opportunity_name=opp.name,
                stage=opp.stage,
                amount=opp.amount,
                currency_code=opp.currency_code,
                probability=opp.probability,
                won_at=opp.won_at,
                lead_source=ls,
                created_at=opp.created_at,
                updated_at=opp.updated_at,
            )
        )
    return facts


def build_fact_revenue(
    invoices: Sequence[SilverInvoices],
    payments: Sequence[SilverPayments],
    customers: dict[uuid.UUID, GoldDimCustomer],
) -> list[GoldFactRevenue]:
    """Approved/paid invoices with payment aggregation."""
    pay_agg: dict[uuid.UUID, tuple[Decimal, int]] = {}
    for p in payments:
        existing = pay_agg.get(p.invoice_id, (Decimal("0"), 0))
        pay_agg[p.invoice_id] = (existing[0] + p.amount, existing[1] + 1)
    cust_by_src = {c.source_customer_id: ck for ck, c in customers.items()}
    facts = []
    for inv in invoices:
        if inv.status not in ("approved", "paid"):
            continue
        revenue_key = make_tenant_key(inv.tenant_id, inv.id)
        customer_key = cust_by_src.get(inv.customer_id)
        pay_total, pay_count = pay_agg.get(inv.id, (Decimal("0"), 0))
        facts.append(
            GoldFactRevenue(
                revenue_key=revenue_key,
                tenant_id=inv.tenant_id,
                source_invoice_id=inv.id,
                customer_key=customer_key,
                invoice_date_key=make_date_key(inv.invoice_date),
                due_date_key=make_date_key(inv.due_date),
                invoice_number=inv.invoice_number,
                status=inv.status,
                total=quantize_money(inv.total),
                currency_code=inv.currency_code,
                payment_total=quantize_money(pay_total),
                payment_count=pay_count,
                is_paid=inv.status == "paid",
                created_at=inv.created_at,
                updated_at=inv.updated_at,
            )
        )
    return facts


_TERMINAL_STAGES = frozenset({"won", "lost"})


def build_fact_pipeline(
    opportunities: Sequence[SilverCrmOpportunities],
) -> list[GoldFactPipeline]:
    """Active (non-terminal) opportunities. Excludes won/lost."""
    facts = []
    for opp in opportunities:
        if opp.stage in _TERMINAL_STAGES:
            continue
        rep_key = (
            make_tenant_key(opp.tenant_id, opp.owner_id)
            if opp.owner_id
            else make_tenant_key(opp.tenant_id, _UNASSIGNED)
        )
        facts.append(
            GoldFactPipeline(
                pipeline_key=make_tenant_key(opp.tenant_id, opp.id),
                tenant_id=opp.tenant_id,
                source_opportunity_id=opp.id,
                rep_key=rep_key,
                created_date_key=make_date_key(opp.created_at),
                expected_close_date_key=make_date_key(opp.expected_close_date)
                if opp.expected_close_date
                else None,
                opportunity_name=opp.name,
                stage=opp.stage,
                amount=opp.amount,
                currency_code=opp.currency_code,
                probability=opp.probability,
                days_in_stage=0,
                created_at=opp.created_at,
                updated_at=opp.updated_at,
            )
        )
    return facts

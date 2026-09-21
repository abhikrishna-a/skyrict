"""Command-line entry point for the Skyrict Fabric medallion.

Subcommands:
* ``silver-clean``  -- apply Silver transforms to raw Bronze rows (JSON in/out)
* ``gold-build``    -- assemble Gold star schema from Silver rows (JSON in/out)
* ``gold-reconcile``-- compare Gold aggregates against expected totals
* ``lineage-report``-- print the Bronze -> Silver -> Gold lineage registry

All inputs are file paths; credentials never appear on the command line.
"""

from __future__ import annotations

import json
from pathlib import Path  # noqa: TC003 -- typer inspects annotations at runtime
from typing import Annotated, Any

import typer

from skyrict_fabric.gold import (
    build_dim_customer,
    build_dim_product,
    build_dim_rep,
    build_fact_deals,
    build_fact_pipeline,
    build_fact_revenue,
)
from skyrict_fabric.lineage import LINEAGE_REGISTRY
from skyrict_fabric.reconciliation import reconcile_totals
from skyrict_fabric.silver import (
    transform_crm_customers,
    transform_crm_leads,
    transform_crm_opportunities,
    transform_currencies,
    transform_invoices,
    transform_journal_lines,
    transform_payments,
    transform_products,
    transform_sales_order_lines,
    transform_sales_orders,
)

app = typer.Typer(help="Skyrict Fabric medallion ETL (Bronze -> Silver -> Gold).")

_SILVER_TRANSFORMS: dict[str, Any] = {
    "erp_currencies": transform_currencies,
    "erp_crm_leads": transform_crm_leads,
    "erp_crm_opportunities": transform_crm_opportunities,
    "erp_crm_customers": transform_crm_customers,
    "erp_sales_orders": transform_sales_orders,
    "erp_sales_order_lines": transform_sales_order_lines,
    "erp_invoices": transform_invoices,
    "erp_payments": transform_payments,
    "erp_journal_lines": transform_journal_lines,
    "erp_products": transform_products,
}


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _dump_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, default=str)
    typer.echo(f"wrote {path}")


@app.command("silver-clean")
def silver_clean(
    source_json: Annotated[Path, typer.Argument(help="JSON: {table_name: [rows]}")],
    output_json: Annotated[Path, typer.Argument(help="JSON output path")],
) -> None:
    """Apply Silver transforms to raw Bronze rows, keyed by source table."""
    source = _load_json(source_json)
    result: dict[str, list[dict[str, Any]]] = {}
    for table, rows in source.items():
        transform = _SILVER_TRANSFORMS.get(table)
        if transform is None:
            typer.echo(f"warning: no transform for {table}, skipping", err=True)
            continue
        result[table] = [transform(row).model_dump(mode="json") for row in rows]
    _dump_json(output_json, result)


@app.command("gold-build")
def gold_build(
    silver_json: Annotated[Path, typer.Argument(help="JSON: {silver_table: [rows]}")],
    output_json: Annotated[Path, typer.Argument(help="JSON output path")],
) -> None:
    """Assemble Gold star schema from Silver rows."""
    from skyrict_fabric.schema import (
        SilverCrmCustomers,
        SilverCrmLeads,
        SilverCrmOpportunities,
        SilverInvoices,
        SilverPayments,
        SilverProducts,
    )

    silver = _load_json(silver_json)
    customers = [SilverCrmCustomers(**r) for r in silver.get("silver_crm_customers", [])]
    leads = [SilverCrmLeads(**r) for r in silver.get("silver_crm_leads", [])]
    opportunities = [
        SilverCrmOpportunities(**r) for r in silver.get("silver_crm_opportunities", [])
    ]
    invoices = [SilverInvoices(**r) for r in silver.get("silver_invoices", [])]
    payments = [SilverPayments(**r) for r in silver.get("silver_payments", [])]
    products = [SilverProducts(**r) for r in silver.get("silver_products", [])]

    dim_customer = build_dim_customer(customers)
    dim_product = build_dim_product(products)
    dim_rep = build_dim_rep(opportunities, leads)
    fact_deals = build_fact_deals(opportunities, dim_customer, leads)
    fact_revenue = build_fact_revenue(invoices, payments, dim_customer)
    fact_pipeline = build_fact_pipeline(opportunities)

    result = {
        "gold_dim_customer": [c.model_dump(mode="json") for c in dim_customer.values()],
        "gold_dim_product": [p.model_dump(mode="json") for p in dim_product.values()],
        "gold_dim_rep": [r.model_dump(mode="json") for r in dim_rep.values()],
        "gold_fact_deals": [f.model_dump(mode="json") for f in fact_deals],
        "gold_fact_revenue": [f.model_dump(mode="json") for f in fact_revenue],
        "gold_fact_pipeline": [f.model_dump(mode="json") for f in fact_pipeline],
    }
    _dump_json(output_json, result)


@app.command("gold-reconcile")
def gold_reconcile(
    gold_json: Annotated[Path, typer.Argument(help="JSON output of gold-build")],
    expected_json: Annotated[Path, typer.Argument(help="JSON: {table.metric[.currency]: value}")],
) -> None:
    """Compare Gold aggregates against expected totals; exit 1 on any failure."""
    from skyrict_fabric.schema import (
        GoldDimCustomer,
        GoldFactDeals,
        GoldFactPipeline,
        GoldFactRevenue,
    )

    gold = _load_json(gold_json)
    expected = _load_json(expected_json)
    fact_deals = [GoldFactDeals(**r) for r in gold.get("gold_fact_deals", [])]
    fact_revenue = [GoldFactRevenue(**r) for r in gold.get("gold_fact_revenue", [])]
    fact_pipeline = [GoldFactPipeline(**r) for r in gold.get("gold_fact_pipeline", [])]
    dim_customer = {
        r["customer_key"]: GoldDimCustomer(**r) for r in gold.get("gold_dim_customer", [])
    }
    results = reconcile_totals(fact_deals, fact_revenue, fact_pipeline, dim_customer, expected)
    failed = 0
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        if not r.passed:
            failed += 1
        ccy = f"/{r.currency}" if r.currency else ""
        typer.echo(f"{status} {r.table}.{r.metric}{ccy}: expected={r.expected} actual={r.actual}")
    if failed:
        raise typer.Exit(code=1)


@app.command("lineage-report")
def lineage_report() -> None:
    """Print the Bronze -> Silver -> Gold lineage registry as a table."""
    header = f"{'bronze':<28} {'silver':<28} {'gold':<24} transform"
    typer.echo(header)
    typer.echo("-" * len(header))
    for entry in LINEAGE_REGISTRY:
        gold = f"{entry.gold_table}.{entry.gold_column}" if entry.gold_table else "-"
        typer.echo(
            f"{entry.bronze_table + '.' + entry.bronze_column:<28} "
            f"{entry.silver_table + '.' + entry.silver_column:<28} {gold:<24} {entry.transform}"
        )


def main() -> None:
    app()


if __name__ == "__main__":
    main()

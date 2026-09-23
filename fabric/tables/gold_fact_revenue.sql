-- Gold: fact_revenue (approved/paid invoices with payment aggregation)
CREATE TABLE IF NOT EXISTS gold_fact_revenue (
    revenue_key         UUID NOT NULL PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    source_invoice_id   UUID NOT NULL,
    customer_key        UUID,
    invoice_date_key    INTEGER NOT NULL DEFAULT 0,
    due_date_key        INTEGER NOT NULL DEFAULT 0,
    invoice_number      VARCHAR(64) NOT NULL,
    status              VARCHAR(32) NOT NULL,
    total               NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code       VARCHAR(3) NOT NULL DEFAULT 'USD',
    payment_total       NUMERIC(18,4) NOT NULL DEFAULT 0,
    payment_count       INTEGER NOT NULL DEFAULT 0,
    is_paid             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    _loaded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_fact_revenue_tenant ON gold_fact_revenue (tenant_id);
CREATE INDEX IF NOT EXISTS ix_gold_fact_revenue_customer ON gold_fact_revenue (customer_key);

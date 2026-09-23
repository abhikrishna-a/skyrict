-- Silver: erp_invoices
CREATE TABLE IF NOT EXISTS silver_invoices (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    invoice_number  VARCHAR(64) NOT NULL,
    customer_id     UUID NOT NULL,
    order_id        UUID,
    invoice_date    DATE,
    due_date        DATE,
    status          VARCHAR(32) NOT NULL DEFAULT 'draft',
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax             NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code   VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(18,4) NOT NULL DEFAULT 1,
    source          VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_ref      VARCHAR(128),
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_invoices_tenant_isolation ON silver_invoices
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

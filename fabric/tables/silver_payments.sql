-- Silver: erp_payments
CREATE TABLE IF NOT EXISTS silver_payments (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    payment_number  VARCHAR(64) NOT NULL,
    invoice_id      UUID NOT NULL,
    customer_id     UUID,
    amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code   VARCHAR(3) NOT NULL DEFAULT 'USD',
    method          VARCHAR(32) NOT NULL DEFAULT 'other',
    status          VARCHAR(32) NOT NULL DEFAULT 'pending',
    payment_date    DATE,
    source          VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_ref      VARCHAR(128),
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_payments_tenant_isolation ON silver_payments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

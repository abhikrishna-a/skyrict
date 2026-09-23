-- Silver: erp_crm_customers
CREATE TABLE IF NOT EXISTS silver_crm_customers (
    tenant_id               UUID NOT NULL,
    id                      UUID NOT NULL,
    customer_code           VARCHAR(64) NOT NULL,
    name                    VARCHAR(255) NOT NULL,
    email                   VARCHAR(255),
    phone                   VARCHAR(32),
    credit_limit            NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code           VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    source_opportunity_id   UUID,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_crm_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_crm_customers_tenant_isolation ON silver_crm_customers
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS ix_silver_crm_customers_tenant_code ON silver_crm_customers (tenant_id, customer_code);

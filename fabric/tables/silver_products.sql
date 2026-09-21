-- Silver: erp_products
CREATE TABLE IF NOT EXISTS silver_products (
    tenant_id               UUID NOT NULL,
    id                      UUID NOT NULL,
    sku                     VARCHAR(128) NOT NULL,
    name                    VARCHAR(255) NOT NULL,
    description             VARCHAR(1000),
    cost_price              NUMERIC(18,4) NOT NULL DEFAULT 0,
    cost_currency_code      VARCHAR(3) NOT NULL DEFAULT 'USD',
    sell_price              NUMERIC(18,4) NOT NULL DEFAULT 0,
    sell_currency_code      VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    reorder_point           INTEGER NOT NULL DEFAULT 0,
    supplier_id             UUID,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_products_tenant_isolation ON silver_products
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Silver: erp_sales_orders
CREATE TABLE IF NOT EXISTS silver_sales_orders (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    order_number    VARCHAR(64) NOT NULL,
    customer_id     UUID NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'draft',
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    discount        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax             NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code   VARCHAR(3) NOT NULL DEFAULT 'USD',
    order_date      DATE,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_sales_orders_tenant_isolation ON silver_sales_orders
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

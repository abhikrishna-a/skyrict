-- Silver: erp_sales_order_lines
CREATE TABLE IF NOT EXISTS silver_sales_order_lines (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    order_id        UUID NOT NULL,
    product_id      UUID NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    unit_price      NUMERIC(18,4) NOT NULL DEFAULT 0,
    discount        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax             NUMERIC(18,4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code   VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_sales_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_sales_order_lines_tenant_isolation ON silver_sales_order_lines
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
